"""Court clicks in source pixels, mapped onto an 18 by 9 meter floor."""

COURT_POINTS = (
    ("near_left_baseline", "Near baseline, left corner", (0.0, 0.0)),
    ("near_right_baseline", "Near baseline, right corner", (9.0, 0.0)),
    ("near_left_attack", "Near attack line, left", (0.0, 6.0)),
    ("near_right_attack", "Near attack line, right", (9.0, 6.0)),
    ("center_left", "Center line, left", (0.0, 9.0)),
    ("center_right", "Center line, right", (9.0, 9.0)),
    ("far_left_attack", "Far attack line, left", (0.0, 12.0)),
    ("far_right_attack", "Far attack line, right", (9.0, 12.0)),
    ("far_left_baseline", "Far baseline, left corner", (0.0, 18.0)),
    ("far_right_baseline", "Far baseline, right corner", (9.0, 18.0)),
)

COURT_METERS = {point_id: meters for point_id, _label, meters in COURT_POINTS}
POINT_LABELS = {point_id: label for point_id, label, _meters in COURT_POINTS}
ORIENTATIONS = (
    ("bottom", "Bottom"),
    ("top", "Top"),
    ("left", "Left"),
    ("right", "Right"),
)
# u is camera-left (0) to camera-right (1). v is near (0) to far (1).
_CAMERA_PLACE = {
    "near_left_baseline": (0.0, 0.0),
    "near_right_baseline": (1.0, 0.0),
    "near_left_attack": (0.0, 6 / 18),
    "near_right_attack": (1.0, 6 / 18),
    "center_left": (0.0, 0.5),
    "center_right": (1.0, 0.5),
    "far_left_attack": (0.0, 12 / 18),
    "far_right_attack": (1.0, 12 / 18),
    "far_left_baseline": (0.0, 1.0),
    "far_right_baseline": (1.0, 1.0),
}
MIN_POINTS = 4
# 1.5% of a 1920-wide frame. Shown in the marker; it does not block a save.
ERROR_LIMIT_PX = 28.8


class CourtMapError(ValueError):
    pass


def image_fraction(orientation: str, point_id: str) -> tuple[float, float]:
    """Where a court crossing sits in the picture. x is right, y is down."""
    if orientation not in {item[0] for item in ORIENTATIONS}:
        raise CourtMapError(f"Camera orientation {orientation!r} is not one of bottom, top, left, or right.")
    u, v = _CAMERA_PLACE[point_id]
    if orientation == "bottom":
        return u, 1 - v
    if orientation == "top":
        return u, v
    if orientation == "left":
        return v, 1 - u
    return 1 - v, u


def picture_hint(x: float, y: float) -> str:
    if y < 0.15:
        band = "Top"
    elif y < 0.38:
        band = "Upper"
    elif y < 0.62:
        band = "Middle"
    elif y < 0.85:
        band = "Lower"
    else:
        band = "Bottom"
    side = "left" if x < 0.5 else "right"
    return f"{band} {side} of the picture"


def catalog_for(orientation: str) -> list[dict]:
    rows = []
    for index, (point_id, court_label, _meters) in enumerate(COURT_POINTS, start=1):
        x, y = image_fraction(orientation, point_id)
        rows.append(
            {
                "id": point_id,
                "number": index,
                "court": court_label,
                "picture": picture_hint(x, y),
                "x": round(x * 100, 1),
                "y": round(y * 100, 1),
            }
        )
    return rows


def homography(source_points: list[tuple[float, float]], destination_points: list[tuple[float, float]]) -> list[float]:
    """Map source (u, v) to destination (x, y). The last matrix value is fixed at 1."""
    if len(source_points) != len(destination_points) or len(source_points) < MIN_POINTS:
        raise CourtMapError(f"A court map needs at least {MIN_POINTS} clicks.")
    rows: list[list[float]] = []
    targets: list[float] = []
    for (u, v), (x, y) in zip(source_points, destination_points):
        rows.append([u, v, 1, 0, 0, 0, -x * u, -x * v])
        targets.append(x)
        rows.append([0, 0, 0, u, v, 1, -y * u, -y * v])
        targets.append(y)
    try:
        solved = _least_squares(rows, targets)
    except CourtMapError as exc:
        raise CourtMapError("Those clicks sit too close to one line to map the court.") from exc
    return solved + [1.0]


def apply_homography(matrix: list[float], u: float, v: float) -> tuple[float, float]:
    x = matrix[0] * u + matrix[1] * v + matrix[2]
    y = matrix[3] * u + matrix[4] * v + matrix[5]
    w = matrix[6] * u + matrix[7] * v + matrix[8]
    if abs(w) < 1e-9:
        raise CourtMapError("A click landed outside the court map.")
    return x / w, y / w


def build_view(points: dict, *, media_ms: int, width: int, height: int, orientation: str = "bottom") -> dict:
    image_fraction("bottom" if orientation is None else orientation, "near_left_baseline")
    cleaned: dict = {}
    image_points: list[tuple[float, float]] = []
    court_points: list[tuple[float, float]] = []
    for point_id, _label, meters in COURT_POINTS:
        mark = points.get(point_id, "missing")
        if mark == "missing":
            continue
        if mark is None:
            cleaned[point_id] = None
            continue
        if not isinstance(mark, dict) or "x" not in mark or "y" not in mark:
            raise CourtMapError(f"{POINT_LABELS[point_id]} is not a click.")
        x = float(mark["x"])
        y = float(mark["y"])
        if not (0 <= x <= width and 0 <= y <= height):
            raise CourtMapError(f"{POINT_LABELS[point_id]} is outside the picture.")
        cleaned[point_id] = {"x": round(x, 2), "y": round(y, 2)}
        image_points.append((x, y))
        court_points.append(meters)

    view = {
        "media_ms": int(media_ms),
        "width": width,
        "height": height,
        "orientation": orientation or "bottom",
        "points": cleaned,
        "click_count": len(image_points),
    }
    if len(image_points) < MIN_POINTS:
        view["status"] = "needs_clicks"
        return view
    image_to_court = homography(image_points, court_points)
    court_to_image = homography(court_points, image_points)
    errors = []
    for (u, v), (x, y) in zip(image_points, court_points):
        pu, pv = apply_homography(court_to_image, x, y)
        errors.append(((pu - u) ** 2 + (pv - v) ** 2) ** 0.5)
    mean_error = sum(errors) / len(errors)
    view.update(
        {
            "status": "ready" if mean_error <= ERROR_LIMIT_PX else "check_clicks",
            "mean_error_px": round(mean_error, 2),
            "image_to_court": [round(value, 8) for value in image_to_court],
            "court_to_image": [round(value, 8) for value in court_to_image],
        }
    )
    return view


def _least_squares(rows: list[list[float]], targets: list[float]) -> list[float]:
    columns = len(rows[0])
    normal = [[0.0] * columns for _ in range(columns)]
    vector = [0.0] * columns
    for row, target in zip(rows, targets):
        for i in range(columns):
            vector[i] += row[i] * target
            for j in range(columns):
                normal[i][j] += row[i] * row[j]
    return _solve(normal, vector)


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    augmented = [row[:] + [vector[index]] for index, row in enumerate(matrix)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(augmented[row][col]))
        if abs(augmented[pivot][col]) < 1e-8:
            raise CourtMapError("The clicks do not define a court.")
        augmented[col], augmented[pivot] = augmented[pivot], augmented[col]
        scale = augmented[col][col]
        for j in range(col, size + 1):
            augmented[col][j] /= scale
        for row in range(size):
            if row == col:
                continue
            factor = augmented[row][col]
            for j in range(col, size + 1):
                augmented[row][j] -= factor * augmented[col][j]
    return [augmented[index][size] for index in range(size)]
