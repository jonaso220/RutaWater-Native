"""Store marketing images for any app, from raw simulator / emulator captures.

An app script defines BRAND and SLIDES and calls storekit.main(BRAND, SLIDES).

BRAND = dict(
    name='DropLedger', icon='/abs/icon.png', dark=False,
    root='/abs/folder',            # holds raw/<capture>.png; mk/ and out/ are created here
)
SLIDES = [dict(
    name='ruta', eyebrow='...', title='Texto <em>destacado</em>', sub='...',
    accent=('#1463FF', '#7FB0FF'), layout='top' | 'bottom' | 'duo',
    shots=dict(iphone=['iphone_home'], ipad=['ipad_home'], android=['android_home']),
)]
Kinds: iphone (1320x2868), ipad (2064x2752), android (1440x2560 canvas, any raw size),
tablet (Android tablet for Google Play, 1440x2560 canvas, raw around 1600x2560).
"""
import os
import struct
import subprocess
import sys

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'storekit-chrome-profile')

CANVAS = {'iphone': (1320, 2868), 'ipad': (2064, 2752), 'android': (1440, 2560), 'tablet': (1440, 2560)}

# Sizes per kind: margins, type, where the copy starts, device widths per layout.
SPEC = {
    'iphone': dict(mx=92, cell=110, efont=36, hfont=128, pfont=50, bicon=132, bfont=84, bmb=70,
                   copy_top=150, gap=110, top_w=1040, bottom_w=1010, bottom_y=2010, duo_w=730),
    'ipad': dict(mx=150, cell=130, efont=44, hfont=156, pfont=60, bicon=150, bfont=96, bmb=60,
                 copy_top=140, gap=100, top_w=1720, bottom_w=1720, bottom_y=1980, duo_w=1280),
    'android': dict(mx=100, cell=120, efont=38, hfont=132, pfont=52, bicon=132, bfont=84, bmb=60,
                    copy_top=130, gap=100, top_w=960, bottom_w=960, bottom_y=1800, duo_w=760),
    'tablet': dict(mx=100, cell=120, efont=38, hfont=124, pfont=50, bicon=120, bfont=78, bmb=50,
                   copy_top=120, gap=90, top_w=1200, bottom_w=1200, bottom_y=1800, duo_w=820),
}


def rgba(hex_color, alpha):
    h = hex_color.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return f'rgba({r},{g},{b},{alpha})'


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%(W)dpx;height:%(H)dpx;overflow:hidden;background:%(base2)s}
body{font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:%(text)s;position:relative;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:
  radial-gradient(%(g1)s at %(p1)s, %(c1)s 0%%, transparent 70%%),
  radial-gradient(%(g2)s at %(p2)s, %(c2)s 0%%, transparent 70%%),
  linear-gradient(180deg,%(base1)s 0%%,%(base2)s 100%%)}
.grid{position:absolute;inset:0;background-image:
  linear-gradient(%(gridc)s 2px,transparent 2px),
  linear-gradient(90deg,%(gridc)s 2px,transparent 2px);
  background-size:%(cell)dpx %(cell)dpx;
  -webkit-mask-image:radial-gradient(ellipse 75%% 55%% at 50%% %(gridy)s,#000 0%%,transparent 100%%)}
.col{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:%(copy_top)dpx}
.copy{align-self:stretch;margin:0 %(mx)dpx;flex:none}
.copy.abs{position:absolute;left:%(mx)dpx;right:%(mx)dpx;margin:0}
.brand{display:flex;align-items:center;gap:30px;margin-bottom:%(bmb)dpx}
.brand img{width:%(bicon)dpx;height:%(bicon)dpx;border-radius:22%%;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.brand span{font-size:%(bfont)dpx;font-weight:800;letter-spacing:-2px}
.eyebrow{display:inline-block;font-size:%(efont)dpx;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  padding:.42em .95em;border-radius:999px;background:%(ebg)s;color:%(ecolor)s;border:2px solid %(eborder)s}
h1{font-size:%(hfont)dpx;line-height:1.03;font-weight:800;letter-spacing:-.032em;margin-top:.34em}
h1 em{font-style:normal;white-space:nowrap;background:linear-gradient(95deg,%(a1)s 0%%,%(a2)s 100%%);-webkit-background-clip:text;background-clip:text;color:transparent;
  padding-bottom:.12em}
p{font-size:%(pfont)dpx;line-height:1.3;color:%(sub)s;margin-top:.7em;font-weight:500}
.dev{position:relative;flex:none;background:#04040A;
  box-shadow:0 0 0 4px %(edge1)s, 0 0 0 9px %(edge2)s, 0 80px 160px %(shadow)s, 0 0 260px %(glow)s}
.dev.abs{position:absolute}
.dev .screen{position:relative;width:100%%;height:100%%;overflow:hidden;background:#fff}
.dev .screen img{display:block;width:100%%}
.island{position:absolute;left:35.75%%;width:28.5%%;top:1.33%%;height:3.45%%;border-radius:999px;background:#000}
.btn{position:absolute;background:%(edge1)s;border-radius:6px}
.duo{position:relative;flex:none;align-self:stretch}
"""


def device(kind, raw_dir, img, width, rotate=0, z=1, pos=None):
    """A device frame `width` px wide with the capture inside. Returns (html, height)."""
    path = os.path.join(raw_dir, img + '.png')
    rw, rh = png_size(path)
    if kind == 'iphone':
        bezel, radius = round(width * 0.021), round(width * 0.135)
    elif kind == 'ipad':
        bezel, radius = round(width * 0.027), round(width * 0.046)
    elif kind == 'tablet':
        bezel, radius = round(width * 0.026), round(width * 0.05)
    else:
        bezel, radius = round(width * 0.02), round(width * 0.085)
    sw = width - 2 * bezel
    sh = round(sw * rh / rw)
    height = sh + 2 * bezel
    style = f'width:{width}px;height:{height}px;padding:{bezel}px;border-radius:{radius}px;z-index:{z};'
    cls = 'dev'
    if pos is not None:
        cls += ' abs'
        style += f'left:{pos[0]}px;top:{pos[1]}px;'
    if rotate:
        style += f'transform:rotate({rotate}deg);'
    extra = ''
    bw = max(6, round(width * 0.008))
    buttons = ''
    if kind == 'iphone':
        extra = '<div class="island"></div>'
        for y, h in ((0.2, 0.035), (0.27, 0.062), (0.345, 0.062)):
            buttons += (f'<div class="btn" style="left:-{bw + 5}px;top:{round(height * y)}px;'
                        f'width:{bw}px;height:{round(height * h)}px"></div>')
        buttons += (f'<div class="btn" style="right:-{bw + 5}px;top:{round(height * .3)}px;'
                    f'width:{bw}px;height:{round(height * .095)}px"></div>')
    elif kind == 'android':
        hole = round(sw * 0.042)
        extra = (f'<div style="position:absolute;left:{(sw - hole) // 2}px;top:{round(sw * 0.016)}px;'
                 f'width:{hole}px;height:{hole}px;border-radius:50%;background:#000"></div>')
        for y, h in ((0.2, 0.05), (0.29, 0.105)):
            buttons += (f'<div class="btn" style="right:-{bw + 5}px;top:{round(height * y)}px;'
                        f'width:{bw}px;height:{round(height * h)}px"></div>')
    elif kind == 'tablet':
        for y, h in ((0.07, 0.03), (0.115, 0.06)):
            buttons += (f'<div class="btn" style="right:-{bw + 5}px;top:{round(height * y)}px;'
                        f'width:{bw}px;height:{round(height * h)}px"></div>')
    screen = (f'<div class="screen" style="border-radius:{radius - bezel}px">'
              f'<img src="file://{path}">{extra}</div>')
    return f'<div class="{cls}" style="{style}">{buttons}{screen}</div>', height


def slide_html(brand, kind, spec, first):
    W, H = CANVAS[kind]
    s = SPEC[kind]
    a1, a2 = spec['accent']
    dark = spec.get('dark', brand.get('dark', True))
    layout = spec['layout']
    shots = spec['shots'][kind]
    if layout == 'duo' and len(shots) < 2:
        layout = 'top'
    raw = os.path.join(brand['root'], 'raw')
    v = dict(s, W=W, H=H, a1=a1, a2=a2,
             g1='%dpx %dpx' % (W * .95, H * .40), g2='%dpx %dpx' % (W * .9, H * .42),
             p1='12% 4%', p2='100% 62%', gridy='24%')
    if dark:
        v.update(base1=brand.get('dark_base1', brand.get('base1', '#12121F') if brand.get('dark', True) else '#12121F'),
                 base2=brand.get('dark_base2', brand.get('base2', '#07070D') if brand.get('dark', True) else '#07070D'),
                 text='#FFFFFF', sub=brand.get('dark_sub', brand.get('sub', '#B9B9D6') if brand.get('dark', True) else '#B8C4CC'), gridc='rgba(255,255,255,.045)',
                 c1=rgba(a1, .50), c2=rgba(a2, .20), ebg=rgba(a1, .16), eborder=rgba(a1, .45), ecolor=a2,
                 glow=rgba(a1, .30), shadow='rgba(0,0,0,.65)', edge1='#54546A', edge2='#1C1C28')
    else:
        v.update(base1=brand.get('base1', '#FFFFFF'), base2=brand.get('base2', '#EEF2F9'),
                 text=brand.get('text', '#0D1526'), sub=brand.get('sub', '#4A5872'),
                 gridc='rgba(20,40,90,.05)',
                 c1=rgba(a1, .26), c2=rgba(a2, .22), ebg=rgba(a1, .10), eborder=rgba(a1, .35), ecolor=a1,
                 glow=rgba(a1, .22), shadow='rgba(20,35,70,.28)', edge1='#2B3040', edge2='#0E1018')
    if layout == 'bottom':
        v.update(p1='88% 96%', p2='0% 30%', gridy='78%')
    brand_html = (f'<div class="brand"><img src="file://{brand["icon"]}"><span>{brand["name"]}</span></div>'
                  if first else '')
    copy = f'{brand_html}<div class="eyebrow">{spec["eyebrow"]}</div><h1>{spec["title"]}</h1><p>{spec["sub"]}</p>'
    body = ['<div class="bg"></div><div class="grid"></div>']
    if layout == 'top':
        dev, _ = device(kind, raw, shots[0], s['top_w'])
        body.append(f'<div class="col"><div class="copy">{copy}</div>'
                    f'<div style="height:{s["gap"]}px;flex:none"></div>{dev}</div>')
    elif layout == 'duo':
        w = s['duo_w']
        first_dev, h = device(kind, raw, shots[0], w, rotate=-4, z=1, pos=(34 - s['mx'], 40))
        second, _ = device(kind, raw, shots[1], w, rotate=4, z=2, pos=(W - w + 70 - s['mx'], 220))
        body.append(f'<div class="col"><div class="copy">{copy}</div>'
                    f'<div class="duo" style="height:{h + 300}px;margin:0 {s["mx"]}px">{first_dev}{second}</div></div>')
    elif layout == 'bottom':
        w = s['bottom_w']
        _, h = device(kind, raw, shots[0], w)
        dev, _ = device(kind, raw, shots[0], w, pos=((W - w) // 2, s['bottom_y'] - h))
        body.append(f'{dev}<div class="copy abs" style="top:{s["bottom_y"] + s["gap"]}px">{copy}</div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS % v}</style></head>'
            f'<body>{"".join(body)}</body></html>')


def chrome_shot(page, out, w, h, profile):
    subprocess.run([
        CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', f'--window-size={w},{h}',
        f'--user-data-dir={profile}', '--allow-file-access-from-files',
        f'--screenshot={out}', f'file://{page}',
    ], check=True, capture_output=True, timeout=180)


def sheet(brand, kind, files):
    """One overview image with every slide of a kind."""
    W, H = CANVAS[kind]
    cols = min(len(files), 5 if kind != 'ipad' else 4)
    w = 380 if kind != 'ipad' else 520
    h = round(w * H / W)
    rows = -(-len(files) // cols)
    html = (f'<body style="margin:0;background:#1b1b1b;display:grid;grid-template-columns:repeat({cols},{w}px);'
            f'gap:14px;padding:14px">'
            + ''.join(f'<img src="file://{f}" style="width:{w}px;height:{h}px">' for f in files) + '</body>')
    page = os.path.join(brand['root'], 'mk', f'sheet_{kind}.html')
    out = os.path.join(brand['root'], f'vista-{kind}.png')
    with open(page, 'w') as f:
        f.write(html)
    chrome_shot(page, out, cols * (w + 14) + 14, rows * (h + 14) + 14, PROFILE)
    return out


def main(brand, slides, argv=None):
    """storekit: [kind ...] [name-filter]. Renders out/<kind>/<nn>_<name>.jpg and vista-<kind>.png."""
    argv = sys.argv[1:] if argv is None else argv
    kinds = [a for a in argv if a in CANVAS] or list(CANVAS)
    only = next((a for a in argv if a not in CANVAS), '')
    root = brand['root']
    os.makedirs(os.path.join(root, 'mk'), exist_ok=True)
    for kind in kinds:
        W, H = CANVAS[kind]
        outdir = os.path.join(root, 'out', kind)
        os.makedirs(outdir, exist_ok=True)
        n = 0
        files = []
        for spec in slides:
            if not spec['shots'].get(kind):
                continue
            n += 1
            jpg = os.path.join(outdir, f'{n:02d}_{spec["name"]}.jpg')
            files.append(jpg)
            if only and only not in spec['name']:
                continue
            page = os.path.join(root, 'mk', f'{kind}_{n:02d}_{spec["name"]}.html')
            png = os.path.join(root, 'mk', f'{kind}_{n:02d}_{spec["name"]}.png')
            with open(page, 'w') as f:
                f.write(slide_html(brand, kind, spec, first=n == 1))
            chrome_shot(page, png, W, H, PROFILE)
            subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '92', png, '--out', jpg],
                           check=True, capture_output=True)
            os.remove(png)
        if files and all(os.path.exists(f) for f in files):
            print(sheet(brand, kind, files))
