"""Solar position: NOAA general solar position formulas (Spencer/fractional-year low precision: equation of time and declination Fourier series,
hour angle, zenith/azimuth), https://gml.noaa.gov/grad/solcalc/solareqns.PDF .  Accuracy ~0.1 deg, plenty for a relight.  Apparent elevation adds
Saemundsson refraction (Meeus ch.16).  UTC in, degrees out.  Azimuth clockwise from north."""
import math
from datetime import datetime, timezone, timedelta

def solar(dt_utc, lat, lon):
    doy = dt_utc.timetuple().tm_yday; hr = dt_utc.hour + dt_utc.minute / 60 + dt_utc.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hr - 12) / 24)
    eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    de = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
          - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hr * 60 + eq + 4 * lon                                    # true solar time, minutes
    ha = math.radians(tst / 4 - 180); la = math.radians(lat)
    sin_el = math.sin(la) * math.sin(de) + math.cos(la) * math.cos(de) * math.cos(ha)
    el = math.degrees(math.asin(sin_el))
    az = (math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(de) * math.cos(la))) + 180) % 360
    ref = 1.02 / math.tan(math.radians(el + 10.3 / (el + 5.11))) / 60 if el > -5 else 0.0
    return az, el + ref, el, math.degrees(de), eq

def find_el(day, lat, lon, target, lo_h, hi_h):
    """bisect the UTC hour in [lo_h, hi_h] where apparent elevation crosses `target`."""
    f = lambda h: solar(day + timedelta(hours=h), lat, lon)[1] - target
    a, b = lo_h, hi_h; fa = f(a)
    for _ in range(50):
        m = (a + b) / 2; fm = f(m)
        if (fa < 0) == (fm < 0): a, fa = m, fm
        else: b = m
    return (a + b) / 2
