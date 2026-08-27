"""Shared helpers for the donation resolvers — geometry → ISO codes, etc."""
from __future__ import annotations

from typing import Any

import geonamescache
import reverse_geocode

# Build iso2 -> iso3 once at import. `geonamescache.get_countries()` keys
# countries by their iso2 ("US", "FR", "MG", …) and the value dict carries the
# iso3 under the "iso3" key. We don't need the rest of the country metadata.
_GNC = geonamescache.GeonamesCache()
ISO2_TO_ISO3: dict[str, str] = {
    iso2.upper(): (info.get("iso3") or "").upper()
    for iso2, info in _GNC.get_countries().items()
    if info.get("iso3")
}
ISO3_TO_ISO2: dict[str, str] = {v: k for k, v in ISO2_TO_ISO3.items() if v}


def centroid_latlon(geom: dict[str, Any] | None) -> tuple[float, float] | None:
    """Return a single (lat, lon) representative point for any GeoJSON geometry.

    Mirrors the helper in sources/gdacs.py — we keep this self-contained instead
    of importing it because the resolvers are a distinct layer and we don't want
    a cross-layer dep just for this 10-line function.
    """
    if not geom:
        return None
    coords = geom.get("coordinates")
    gtype = geom.get("type")
    try:
        if gtype == "Point":
            lon, lat = coords[0], coords[1]
        elif gtype == "Polygon":
            ring = coords[0]
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
        elif gtype == "MultiPolygon":
            ring = coords[0][0]
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
        else:
            return None
        return float(lat), float(lon)
    except (TypeError, IndexError, ValueError, ZeroDivisionError):
        return None


def iso_codes_for_geom(geom: dict[str, Any] | None) -> tuple[str | None, str | None]:
    """Return (iso2, iso3) for the centroid of a GeoJSON geometry, or (None,
    None) if we can't resolve it. Multi-country events (e.g. a cyclone tracking
    across three countries) collapse to the country containing the centroid —
    which is acceptable for matching against external feeds that key on a
    single primary country (IFRC GO, GlobalGiving).
    """
    coords = centroid_latlon(geom)
    if not coords:
        return None, None
    hits = reverse_geocode.search([coords])
    if not hits:
        return None, None
    iso2 = (hits[0].get("country_code") or "").upper() or None
    iso3 = ISO2_TO_ISO3.get(iso2) if iso2 else None
    return iso2, iso3
