"""Google Play feature graphic (1024x500, JPEG without alpha), one per language.
Run: python3 marketing/fuente/feature.py [es|en|pt ...]   (no argument: every language)
Same look as the store screenshots: light background, brand blue, real captures of the review account.
Output: marketing/<lang>/play/grafico-<lang>-1024x500.jpg"""
import os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import storekit

ROOT = os.path.dirname(os.path.abspath(__file__))
ICON = os.path.abspath(os.path.join(ROOT, '..', '..', 'ios', 'RutaWaterNative', 'Images.xcassets',
                                    'AppIcon.appiconset', 'AppIcon-Light.png'))
# Headline (one line per <br>, the highlighted part in <em>) and the line under it.
COPY = {
    'es': ('Tu reparto<br>de agua,<br><em>en orden</em>', 'Clientes, paradas y deudas en un solo lugar.'),
    'en': ('Your water<br>route,<br><em>in order</em>', 'Clients, stops and debts in one place.'),
    'pt': ('Sua rota<br>de água,<br><em>em ordem</em>', 'Clientes, paradas e dívidas em um só lugar.'),
}
W, H, SCALE = 1024, 500, 2

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1024px;height:500px;overflow:hidden;background:#DCE9FB}
body{font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#0F172A;position:relative;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:
  radial-gradient(520px 420px at 86% 30%, rgba(29,78,216,.28) 0%, transparent 70%),
  radial-gradient(420px 320px at 8% 105%, rgba(16,185,129,.18) 0%, transparent 70%),
  linear-gradient(180deg,#FFFFFF 0%,#DCE9FB 100%)}
.copy{position:absolute;left:64px;top:54px;width:520px}
.brand{display:flex;align-items:center;gap:16px}
.brand img{width:68px;height:68px;border-radius:22%;box-shadow:0 10px 28px rgba(29,78,216,.30)}
.brand span{font-size:40px;font-weight:800;letter-spacing:-1px}
h1{font-size:62px;line-height:1.04;font-weight:800;letter-spacing:-.032em;margin-top:30px}
h1 em{font-style:normal;white-space:nowrap;background:linear-gradient(95deg,#1D4ED8 0%,#3B82F6 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:.12em}
p{font-size:25px;line-height:1.3;color:#475569;margin-top:18px;font-weight:500}
.dev{position:relative;flex:none;background:#04040A;box-shadow:0 0 0 2px #2A2A38, 0 0 0 4px #0C0C14, 0 30px 60px rgba(15,40,110,.35)}
.dev.abs{position:absolute}
.dev .screen{position:relative;width:100%;height:100%;overflow:hidden;background:#fff}
.dev .screen img{display:block;width:100%}
.btn{position:absolute;background:#2A2A38;border-radius:3px}
"""


def render(lang):
    raw = os.path.join(ROOT, 'raw') if lang == 'es' else os.path.join(ROOT, lang, 'raw')
    out = os.path.abspath(os.path.join(ROOT, '..', lang, 'play', f'grafico-{lang}-1024x500.jpg'))
    title, sub = COPY[lang]
    back, _ = storekit.device('android', raw, 'android_debts', 232, rotate=7, z=1, pos=(794, 92))
    front, _ = storekit.device('android', raw, 'android_home', 262, rotate=-4, z=2, pos=(618, 48))
    html = f"""<!doctype html><meta charset="utf-8"><style>{CSS}</style>
<div class="bg"></div>
<div class="copy">
  <div class="brand"><img src="file://{ICON}"><span>RutaWater</span></div>
  <h1>{title}</h1>
  <p>{sub}</p>
</div>
{back}{front}"""
    with tempfile.TemporaryDirectory() as tmp:
        page, png = os.path.join(tmp, 'feature.html'), os.path.join(tmp, 'feature.png')
        open(page, 'w').write(html)
        subprocess.run([storekit.CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        f'--force-device-scale-factor={SCALE}', f'--window-size={W},{H}',
                        f'--user-data-dir={os.path.join(tmp, "chrome-profile")}', '--allow-file-access-from-files',
                        f'--screenshot={png}', f'file://{page}'], check=True, capture_output=True, timeout=180)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        subprocess.run(['sips', '-z', str(H), str(W), '-s', 'format', 'jpeg', '-s', 'formatOptions', '95', png, '--out', out],
                       check=True, capture_output=True)
    print(out)


if __name__ == '__main__':
    for lang in sys.argv[1:] or list(COPY):
        render(lang)
