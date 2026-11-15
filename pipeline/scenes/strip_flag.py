# Rewrites the downloaded astronaut GLB without its national-flag texture (CONVENTIONS rule 5: no flags).
# The "flag" material stays as a plain patch; astro.ts paints it in the crew member's arm-band colour.
# Usage: python3 -I tools/strip_flag.py <in.glb> public/models/astronaut.glb
import json, struct, sys
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); binc = b[20 + jl + 8:]
drop = {im['bufferView'] for im in j.get('images', [])}
for k in ('images', 'textures', 'samplers'): j.pop(k, None)
for m in j['materials']:
    m.get('pbrMetallicRoughness', {}).pop('baseColorTexture', None)
    if m.get('name') == 'flag': m['name'] = 'patch'
out, remap, views = bytearray(), {}, []
for i, v in enumerate(j['bufferViews']):
    if i in drop: continue
    while len(out) % 4: out.append(0)
    o = v.get('byteOffset', 0); chunk = binc[o:o + v['byteLength']]
    remap[i] = len(views); views.append({**v, 'byteOffset': len(out)}); out += chunk
while len(out) % 4: out.append(0)
j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(out)}]
for a in j['accessors']:
    if 'bufferView' in a: a['bufferView'] = remap[a['bufferView']]
    if 'sparse' in a: raise SystemExit('sparse accessors not handled')
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
body = struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)
print(dst, 12 + len(body), 'bytes; dropped bufferViews', sorted(drop))
