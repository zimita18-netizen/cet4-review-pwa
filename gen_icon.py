from PIL import Image, ImageDraw, ImageFont
import os

out_dir = r'C:/Users/qwera/Documents/四级单词巩固/icons'
os.makedirs(out_dir, exist_ok=True)

GREEN = (90, 143, 106)
GREEN_DARK = (66, 112, 82)
WHITE = (255, 255, 255)

def make(size, path):
    # 渐变背景
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        t = y / size
        r = int(GREEN[0] + (GREEN_DARK[0] - GREEN[0]) * t)
        g = int(GREEN[1] + (GREEN_DARK[1] - GREEN[1]) * t)
        b = int(GREEN[2] + (GREEN_DARK[2] - GREEN[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)

    # 圆角遮罩
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    md.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    img.putalpha(mask)

    # 白色文字
    draw = ImageDraw.Draw(img)
    # 中文字体
    font_paths = [
        r'C:/Windows/Fonts/msyh.ttc',
        r'C:/Windows/Fonts/simhei.ttf',
        r'C:/Windows/Fonts/simsun.ttc',
    ]
    font = None
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(size * 0.5))
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()

    text = '词'
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=WHITE)

    img = img.convert('RGB').convert('RGBA')
    img.save(path)
    print('saved', path, img.size)

make(512, os.path.join(out_dir, 'icon-512.png'))
make(192, os.path.join(out_dir, 'icon-192.png'))
make(180, os.path.join(out_dir, 'icon-180.png'))
