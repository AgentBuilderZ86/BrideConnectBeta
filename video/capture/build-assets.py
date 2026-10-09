# Recadre les captures (dossier passé en argument, sorties des scripts 1 à 3) et les embarque en base64
# dans film/ai-bridge.assets.js, pour que le canvas du film ne soit jamais « contaminé » en file://.
# Usage : python3 build-assets.py <dossier-captures>
import base64, io, json, sys
from pathlib import Path
from PIL import Image

shots = Path(sys.argv[1])
here = Path(__file__).resolve().parent
crops = {  # clé : (fichier, zone en pixels de la capture 2880×1800, None = image entière)
    'c1': ('c1.png', None), 'c2': ('c2.png', None),
    'phone': ('chat.png', (400, 595, 1198, 1800)),
    'dsi': ('dsi.png', (400, 857, 2480, 1692)),
    'copilot': ('copilot.png', (435, 140, 2445, 943)),
    'matrix': ('matrix.png', (432, 518, 1685, 1382)),
    'roadmap': ('roadmap.png', (432, 717, 2448, 1786)),
}
out = {}
for k, (f, box) in crops.items():
    im = Image.open(shots / f).convert('RGB')
    if box: im = im.crop(box)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=90)
    out[k] = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
logo = here.parent.parent / 'intake-agent/static/brand/ai-bridge-nuit-transparent.png'
out['logo'] = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
(here.parent / 'film/ai-bridge.assets.js').write_text('window.ASSETS=' + json.dumps(out) + ';')
