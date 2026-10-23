"""Reverse geocoding + keyword engine for the footage service.

Offline-first: a Dubai/UAE neighbourhood table resolves the common AOI
places instantly (no network, no rate limit); anything else goes through
BigDataCloud's keyless reverse-geocode-client (works from cloud egress,
unlike Nominatim which 403s datacentre IPs) with a Nominatim fallback when
NOMINATIM_USER_AGENT is configured. Every function is pure except
``reverse_geocode`` (network, bounded by a timeout).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import httpx

# name, lat, lon, radius_km, aliases, arabic
DUBAI_NEIGHBOURHOODS = [
    ("Umm Suqeim", 25.147, 55.199, 3.5, ["umm suqeim", "um suqeim", "umm suqaim", "umm suqeim street"], "أم سقيم"),
    ("Jumeirah", 25.218, 55.252, 4.0, ["jumeirah", "jumeira", "jumeirah street", "jumeirah beach"], "جميرا"),
    ("Al Barsha", 25.112, 55.196, 3.5, ["al barsha", "barsha", "al barsha 1", "barsha heights"], "البرشاء"),
    ("Jumeirah Village Circle", 25.058, 55.209, 2.5, ["jvc", "jumeirah village circle", "jumeirah village"], "قرية جميرا الدائرية"),
    ("Dubai Marina", 25.080, 55.140, 2.5, ["dubai marina", "marina", "jbr", "jumeirah beach residence"], "مرسى دبي"),
    ("Al Warqa", 25.192, 55.410, 3.5, ["al warqa", "warqa", "al warqaa"], "الورقاء"),
    ("Business Bay", 25.186, 55.265, 2.5, ["business bay", "downtown dubai", "downtown"], "الخليج التجاري"),
    ("Deira", 25.271, 55.312, 4.0, ["deira", "al rigga", "naif"], "ديرة"),
    ("Bur Dubai", 25.255, 55.297, 3.0, ["bur dubai", "al fahidi", "karama", "al karama"], "بر دبي"),
    ("Al Quoz", 25.139, 55.232, 3.5, ["al quoz", "quoz"], "القوز"),
    ("Al Qusais", 25.275, 55.380, 3.5, ["al qusais", "qusais"], "القصيص"),
    ("Mirdif", 25.221, 55.420, 3.0, ["mirdif", "mirdiff"], "مردف"),
    ("Dubai Silicon Oasis", 25.121, 55.381, 3.0, ["silicon oasis", "dso", "dubai silicon oasis"], "واحة دبي للسيليكون"),
    ("International City", 25.164, 55.408, 2.5, ["international city"], "المدينة العالمية"),
    ("Jebel Ali", 24.985, 55.065, 8.0, ["jebel ali", "jafza"], "جبل علي"),
    ("Dubai Investment Park", 24.990, 55.175, 4.0, ["dubai investment park", "dip"], "مجمع دبي للاستثمار"),
    ("Palm Jumeirah", 25.112, 55.138, 3.0, ["palm jumeirah", "the palm", "palm"], "نخلة جميرا"),
    ("Dubai International Airport", 25.253, 55.365, 3.0, ["dubai airport", "dxb", "dubai international airport"], "مطار دبي"),
    ("Sheikh Zayed Road", 25.197, 55.272, 2.0, ["sheikh zayed road", "szr", "e11"], "شارع الشيخ زايد"),
    ("Al Nahda", 25.293, 55.370, 2.5, ["al nahda", "nahda"], "النهضة"),
    ("Motor City", 25.047, 55.237, 2.5, ["motor city", "sports city", "dubai sports city"], "موتور سيتي"),
    ("Arabian Ranches", 25.050, 55.270, 3.0, ["arabian ranches", "ranches"], "المرابع العربية"),
    ("Hatta", 24.800, 56.120, 8.0, ["hatta"], "حتا"),
]

UAE_CITIES = [
    ("Dubai", 25.2048, 55.2708, 30.0, ["dubai"], "دبي"),
    ("Abu Dhabi", 24.4539, 54.3773, 30.0, ["abu dhabi", "abudhabi"], "أبوظبي"),
    ("Sharjah", 25.3463, 55.4209, 15.0, ["sharjah"], "الشارقة"),
    ("Ajman", 25.4052, 55.5136, 10.0, ["ajman"], "عجمان"),
    ("Ras Al Khaimah", 25.7895, 55.9432, 20.0, ["ras al khaimah", "rak"], "رأس الخيمة"),
    ("Fujairah", 25.1288, 56.3265, 15.0, ["fujairah"], "الفجيرة"),
    ("Umm Al Quwain", 25.5647, 55.5552, 10.0, ["umm al quwain", "uaq"], "أم القيوين"),
    ("Al Ain", 24.2075, 55.7447, 20.0, ["al ain"], "العين"),
]

# Coarse regional fallbacks so a scene far from the UAE still gets a usable
# place word without a network round-trip (the audit scene 13.94N 48.92E
# sits in the Gulf of Aden off Hadramawt).
REGIONS = [
    ("Hadramawt, Yemen", 15.0, 48.8, 220.0, ["hadramawt", "hadhramaut", "mukalla"], "حضرموت"),
    ("Shabwah, Yemen", 14.5, 47.0, 150.0, ["shabwah", "shabwa", "balhaf"], "شبوة"),
    ("Gulf of Aden", 12.8, 47.5, 400.0, ["gulf of aden"], "خليج عدن"),
    ("Aden, Yemen", 12.7855, 45.0187, 60.0, ["aden"], "عدن"),
    ("Hodeidah, Yemen", 14.7978, 42.9545, 60.0, ["hodeidah", "hudaydah"], "الحديدة"),
    ("Sana'a, Yemen", 15.3694, 44.191, 60.0, ["sanaa", "sana'a"], "صنعاء"),
    ("Muscat, Oman", 23.588, 58.3829, 60.0, ["muscat"], "مسقط"),
    ("Doha, Qatar", 25.2854, 51.531, 50.0, ["doha"], "الدوحة"),
    ("Manama, Bahrain", 26.2235, 50.5876, 40.0, ["manama", "bahrain"], "المنامة"),
    ("Riyadh, Saudi Arabia", 24.7136, 46.6753, 80.0, ["riyadh"], "الرياض"),
    ("Strait of Hormuz", 26.56, 56.25, 120.0, ["hormuz", "strait of hormuz"], "مضيق هرمز"),
    ("Mogadishu, Somalia", 2.0469, 45.3182, 80.0, ["mogadishu"], "مقديشو"),
    ("Berbera, Somaliland", 10.4396, 45.0143, 60.0, ["berbera"], "بربرة"),
    ("Tehran, Iran", 35.6892, 51.389, 80.0, ["tehran"], "طهران"),
    ("Bandar Abbas, Iran", 27.1865, 56.2808, 60.0, ["bandar abbas"], "بندر عباس"),
]

ALL_PLACES = DUBAI_NEIGHBOURHOODS + UAE_CITIES + REGIONS


@dataclass
class Place:
    name: str
    lat: float
    lon: float
    source: str
    country: str | None = None
    city: str | None = None
    arabic: str | None = None
    distance_km: float = 0.0
    aliases: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "lat": round(self.lat, 5),
            "lon": round(self.lon, 5),
            "source": self.source,
            "country": self.country,
            "city": self.city,
            "arabic": self.arabic,
            "distance_km": round(self.distance_km, 2),
        }


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _country_for(table_entry) -> str | None:
    name = table_entry[0]
    if table_entry in DUBAI_NEIGHBOURHOODS or table_entry in UAE_CITIES:
        return "AE"
    if "Yemen" in name or name == "Gulf of Aden":
        return "YE"
    if "Oman" in name:
        return "OM"
    if "Qatar" in name:
        return "QA"
    if "Bahrain" in name:
        return "BH"
    if "Saudi" in name:
        return "SA"
    if "Somali" in name:
        return "SO"
    if "Iran" in name:
        return "IR"
    return None


def offline_reverse(lat: float, lon: float) -> Place | None:
    """Nearest table entry whose radius covers the point; neighbourhoods first."""
    best: Place | None = None
    for table in (DUBAI_NEIGHBOURHOODS, UAE_CITIES, REGIONS):
        hits = []
        for entry in table:
            name, plat, plon, radius, aliases, arabic = entry
            d = haversine_km(lat, lon, plat, plon)
            if d <= radius:
                hits.append((d, entry))
        if hits:
            hits.sort(key=lambda h: h[0])
            d, entry = hits[0]
            name, plat, plon, radius, aliases, arabic = entry
            city = "Dubai" if table is DUBAI_NEIGHBOURHOODS else None
            return Place(name=name, lat=plat, lon=plon, source="offline-table", country=_country_for(entry), city=city, arabic=arabic, distance_km=d, aliases=list(aliases))
    return best


def lookup_place_name(text: str) -> Place | None:
    """Forward lookup of a place mentioned in free text (longest alias wins)."""
    q = " " + re.sub(r"[^\w\s']", " ", (text or "").lower()) + " "
    q = re.sub(r"\s+", " ", q)
    best = None
    best_len = 0
    for entry in ALL_PLACES:
        name, plat, plon, radius, aliases, arabic = entry
        for alias in [name.lower(), *aliases]:
            if len(alias) > best_len and (" " + alias + " ") in q:
                best, best_len = entry, len(alias)
        if arabic and arabic in (text or ""):
            if len(arabic) + 10 > best_len:
                best, best_len = entry, len(arabic) + 10
    if not best:
        return None
    name, plat, plon, radius, aliases, arabic = best
    return Place(name=name, lat=plat, lon=plon, source="offline-table", country=_country_for(best), city="Dubai" if best in DUBAI_NEIGHBOURHOODS else None, arabic=arabic, aliases=list(aliases))


async def reverse_geocode(lat: float, lon: float, *, timeout: float = 4.0, nominatim_ua: str | None = None) -> Place:
    """Offline table → BigDataCloud (keyless) → Nominatim (needs a UA) → coordinates."""
    hit = offline_reverse(lat, lon)
    if hit and hit.source == "offline-table" and hit.distance_km <= 12:
        return hit
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                "https://api.bigdatacloud.net/data/reverse-geocode-client",
                params={"latitude": lat, "longitude": lon, "localityLanguage": "en"},
            )
            if r.status_code == 200:
                j = r.json()
                parts = [p for p in [j.get("locality"), j.get("city"), j.get("principalSubdivision"), j.get("countryName")] if p]
                # de-duplicate while keeping order
                seen, names = set(), []
                for p in parts:
                    if p not in seen:
                        seen.add(p)
                        names.append(p)
                if names:
                    return Place(name=", ".join(names[:3]), lat=lat, lon=lon, source="bigdatacloud", country=(j.get("countryCode") or None), city=j.get("city") or j.get("locality") or None, distance_km=0.0)
    except Exception:
        pass
    if nominatim_ua:
        try:
            async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": nominatim_ua}) as client:
                r = await client.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 14, "accept-language": "en"})
                if r.status_code == 200:
                    j = r.json()
                    addr = j.get("address", {})
                    name = addr.get("suburb") or addr.get("neighbourhood") or addr.get("city_district") or addr.get("city") or addr.get("town") or j.get("display_name", "").split(",")[0]
                    if name:
                        return Place(name=name, lat=lat, lon=lon, source="nominatim", country=(addr.get("country_code") or "").upper() or None, city=addr.get("city") or addr.get("town"), distance_km=0.0)
        except Exception:
            pass
    if hit:
        return hit
    return Place(name=f"{lat:.3f}, {lon:.3f}", lat=lat, lon=lon, source="coordinates")


INCIDENT_SYNONYMS = {
    "car crash": ["car crash", "accident", "collision", "crash", "حادث", "حادث سير"],
    "crash": ["crash", "accident", "collision", "حادث"],
    "accident": ["accident", "crash", "collision", "حادث"],
    "fire": ["fire", "blaze", "حريق"],
    "flood": ["flood", "flooding", "rain", "فيضان", "أمطار"],
    "explosion": ["explosion", "blast", "انفجار"],
    "protest": ["protest", "unrest", "مظاهرة"],
    "airstrike": ["airstrike", "strike", "غارة"],
    "drone": ["drone", "missile", "طائرة مسيرة"],
    "storm": ["storm", "sandstorm", "عاصفة"],
    "shooting": ["shooting", "gunfire", "إطلاق نار"],
}

STOP = {"the", "a", "an", "in", "at", "of", "on", "reported", "rebuild", "show", "replay", "footage", "video", "near", "around", "live", "me", "please", "scene", "to", "for", "from", "and", "it", "latest", "recent", "today"}


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[\w']+", (text or "").lower()) if t not in STOP and len(t) > 1]


def incident_terms(keywords: str) -> list[str]:
    kw = (keywords or "").lower()
    out: list[str] = []
    for key, syns in INCIDENT_SYNONYMS.items():
        if key in kw:
            for s in syns:
                if s not in out:
                    out.append(s)
    return out


def build_query_variants(place: Place | None, keywords: str, *, max_variants: int = 6) -> list[str]:
    """English + Arabic query variants: '<place> <incident>', '<place> Street <incident> Dubai Police', ..."""
    base = [t for t in tokens(keywords)]
    place_name = place.name if place else ""
    city = (place.city if place and place.city else "") or ""
    incident = " ".join(base[:3]).strip()
    variants: list[str] = []

    def add(v: str):
        v = re.sub(r"\s+", " ", v).strip()
        if v and v.lower() not in {x.lower() for x in variants}:
            variants.append(v)

    if place_name and incident:
        add(f"{place_name} {incident}")
        add(f"{place_name} {incident} {city or ''}".strip())
        if city == "Dubai" or (place and place.country == "AE"):
            add(f"{place_name} Street {incident} Dubai Police")
    elif place_name:
        add(f"{place_name} incident")
        add(f"{place_name} breaking news")
        if city and city != place_name:
            add(f"{place_name} {city} news")
    elif incident:
        add(incident)
    for term in incident_terms(keywords)[:3]:
        if place_name:
            add(f"{place_name} {term}")
    if place and place.arabic:
        ar_terms = [s for s in incident_terms(keywords) if re.search(r"[\u0600-\u06FF]", s)]
        add(f"{ar_terms[0] if ar_terms else 'حادث'} {place.arabic}")
    if not variants:
        add("breaking news")
    return variants[:max_variants]


def relevance_score(text: str, variants: list[str], place: Place | None, keywords: str = "") -> float:
    """0..1 = incident-term match (0.45) + place match (0.35, city 0.1) + query-token overlap (0.2)."""
    t = (text or "").lower()
    if not t:
        return 0.0
    ttoks = set(tokens(t))
    best = 0.0
    for v in variants:
        vt = set(tokens(v))
        if not vt:
            continue
        best = max(best, len(vt & ttoks) / len(vt))
    terms = incident_terms(keywords) or [k for k in tokens(keywords)]
    incident = 0.45 if any(term and term in t for term in terms) else 0.0
    if not terms:
        incident = 0.25
    boost = 0.0
    if place:
        names = [place.name.lower(), *(a.lower() for a in place.aliases)]
        if place.arabic:
            names.append(place.arabic)
        if any(n and n in t for n in names):
            boost = 0.35
        elif place.city and place.city.lower() in t:
            boost = 0.1
        elif place.country == "AE" and ("dubai" in t or "uae" in t or "emirates" in t):
            boost = 0.08
    return min(1.0, round(incident + boost + best * 0.2, 4))
