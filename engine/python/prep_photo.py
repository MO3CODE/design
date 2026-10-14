"""تجهيز صورة حقيقية لتصاميم بوابة المستثمر: تدريج لوني سينمائي بألوان الهوية + حبيبات فيلم + قص خلفية اختياري.
الهدف: الصورة تبان «مطبوعة/مصوّرة» ومتناسقة مع الهوية — مو لامعة ومثالية زي صور الذكاء الاصطناعي.

python scripts/prep_photo.py <src> <out.png|jpg> [--treat noir|gold|sepia|warm|mono|natural] [--cutout] [--grain 0.06] [--max 3400]
يطبع JSON: {"file","w","h","aspect","lum"}
"""
import sys as _s; _s.stdout.reconfigure(encoding='utf-8'); _s.stderr.reconfigure(encoding='utf-8')
import argparse, json, sys, os
import numpy as np
from PIL import Image, ImageOps, ImageFilter

def hexrgb(h): h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], np.float32) / 255

def curve(x, lift=0.0, gain=1.0, contrast=1.0):
    x = (x - .5) * contrast + .5
    return np.clip(lift + x * (gain - lift), 0, 1)

def tone_map(lum, stops):
    """lum 0..1 → لون من قائمة نقاط [(pos, '#hex')]"""
    pos = np.array([p for p, _ in stops], np.float32); cols = np.stack([hexrgb(c) for _, c in stops])
    out = np.zeros(lum.shape + (3,), np.float32)
    for ch in range(3): out[..., ch] = np.interp(lum, pos, cols[:, ch])
    return out

def grade(rgb, treat):
    lum = (rgb @ np.array([.2126, .7152, .0722], np.float32))[..., None]
    if treat == 'noir':      # ظلال بنية-سوداء، إضاءات كريمية-ذهبية، تشبع منخفض — سينمائي فخم
        tone = tone_map(lum[..., 0], [(0, '#0E0B08'), (.35, '#3A2E20'), (.7, '#B79A6B'), (1, '#F6E6C4')])
        out = tone * .78 + (lum * .25 + rgb * .75) * .22
        out = curve(out, lift=.02, gain=.97, contrast=1.10)
    elif treat == 'gold':
        tone = tone_map(lum[..., 0], [(0, '#2A1F12'), (.5, '#B58E57'), (1, '#FBEBCB')])
        out = curve(tone * .72 + rgb * .28, lift=.04, gain=.98, contrast=1.05)
    elif treat == 'sepia':
        tone = tone_map(lum[..., 0], [(0, '#2F2a1E'), (.55, '#8F8160'), (1, '#EDE5CF')])
        out = curve(tone, lift=.06, gain=.95, contrast=.95)
    elif treat == 'mono':
        out = curve(np.repeat(lum, 3, -1), lift=.05, gain=.96, contrast=1.08) * hexrgb('#FFF8EC')
    elif treat == 'warm':
        sat = lum + (rgb - lum) * .8
        out = curve(sat * np.array([1.04, 1.0, .9], np.float32), lift=.03, gain=.98, contrast=1.03)
    elif treat == 'none':
        out = rgb
    else:                    # natural
        out = curve(rgb, lift=.015, gain=.99, contrast=1.02)
    return np.clip(out, 0, 1)

def add_grain(rgb, amount, seed=7):
    if amount <= 0: return rgb
    rng = np.random.default_rng(seed)
    n = rng.standard_normal(rgb.shape[:2]).astype(np.float32)
    n = np.array(Image.fromarray(((n * 40 + 128).clip(0, 255)).astype(np.uint8)).filter(ImageFilter.GaussianBlur(.6)), np.float32) / 255 - .5
    lum = rgb.mean(-1)
    w = amount * (1.2 - np.abs(lum - .5) * 1.2)      # الحبيبات أوضح بالدرجات المتوسطة (زي الفيلم)
    return np.clip(rgb + (n * w)[..., None], 0, 1)

def keep_main(mask):
    """يشيل البقايا المنفصلة (طرف عمود/شخص ثاني على حافة الصورة): يبقي أكبر جسم + أي جسم ≥ 25% منه."""
    try:
        import cv2
    except ImportError:
        return mask
    m = np.asarray(mask); b = (m > 40).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, 8)
    if n <= 2: return mask
    areas = st[1:, cv2.CC_STAT_AREA]; big = areas.max()
    keep = np.isin(lab, [i + 1 for i, a_ in enumerate(areas) if a_ >= big * .25])
    return Image.fromarray(np.where(keep, m, 0).astype(np.uint8))

def cutout(img):
    from rembg import remove, new_session
    for model in ('birefnet-general-lite', 'isnet-general-use', 'u2net'):
        try:
            m = remove(img.convert('RGB'), session=new_session(model), only_mask=True, post_process_mask=True).convert('L')
            return keep_main(m), model
        except Exception as e:
            print(f'  [cutout] {model} فشل: {e}', file=sys.stderr)
    raise RuntimeError('ما قدرت أقص الخلفية — ثبّت rembg')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--treat', default='natural'); ap.add_argument('--cutout', action='store_true')
    ap.add_argument('--grain', type=float, default=.06); ap.add_argument('--max', type=int, default=3400)
    ap.add_argument('--nocrop', action='store_true'); ap.add_argument('--crop', default=None, help='x0,y0,x1,y1 بنسب 0..1')
    a = ap.parse_args()
    im = ImageOps.exif_transpose(Image.open(a.src))
    if a.crop:
        x0, y0, x1, y1 = map(float, a.crop.split(',')); W, H = im.size
        im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
    im.thumbnail((a.max, a.max), Image.LANCZOS)
    info = {}
    mask = None
    if im.mode in ('RGBA', 'LA', 'P') and np.asarray(im.convert('RGBA'))[..., 3].min() < 250:
        mask = im.convert('RGBA').split()[-1]; info['alpha'] = 'source'          # أصل مقصوص جاهز — لا تعيد القص
        bb = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
        if bb: im, mask = im.crop(bb), mask.crop(bb)
    elif a.cutout:
        mask, model = cutout(im); info['cutout_model'] = model
        bb = mask.point(lambda v: 255 if v > 24 else 0).getbbox()
        if bb and not a.nocrop: im, mask = im.crop(bb), mask.crop(bb)
    rgb = np.asarray(im.convert('RGB'), np.float32) / 255
    rgb = add_grain(grade(rgb, a.treat), a.grain)
    out = Image.fromarray((rgb * 255 + .5).astype(np.uint8))
    if mask is not None:
        out.putalpha(mask.filter(ImageFilter.GaussianBlur(.7)))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    if a.out.lower().endswith('.jpg'): out.convert('RGB').save(a.out, quality=92)
    else: out.save(a.out, optimize=True)
    info.update(file=os.path.abspath(a.out), w=out.width, h=out.height, aspect=round(out.width / out.height, 4),
                lum=round(float(rgb.mean()), 3))
    print(json.dumps(info, ensure_ascii=False))

if __name__ == '__main__':
    main()
