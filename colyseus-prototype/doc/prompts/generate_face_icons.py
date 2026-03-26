"""Nano Banana (Gemini) で動物の顔アイコンを一括生成"""
import mimetypes
import os
import time
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env"))

OUTPUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "client", "src", "assets", "animals"
)
os.makedirs(OUTPUT_DIR, exist_ok=True)

ANIMALS = {
    "RessaPanda": "Cute kawaii red panda face, front view, big sparkly eyes, reddish-brown fur, white cheek markings, pointed ears with white edges, small black nose, soft rounded shapes, adorable expression, white background, no frame, no text, head only",
    "RosyFacedLovebird": "Cute kawaii scarlet macaw parrot face, front view, big sparkly eyes, red feathered head, white face area around eyes, curved grey beak, colorful feathers, soft rounded shapes, adorable expression, white background, no frame, no text, head only",
    "Penguin": "Cute kawaii penguin face, front view, big sparkly eyes, black head, white cheeks, bright orange beak, round head shape, soft rounded shapes, adorable expression, white background, no frame, no text, head only",
    "Lion": "Cute kawaii male lion face, front view, big sparkly eyes, golden fluffy mane around face, tawny fur, dark nose, soft rounded shapes, adorable proud expression, white background, no frame, no text, head only",
    "GiantPanda": "Cute kawaii giant panda face, front view, big sparkly eyes, white face, large black eye patches, round black ears, black nose, soft rounded shapes, adorable gentle expression, white background, no frame, no text, head only",
    "CaliforniaSeaLion": "Cute kawaii sea lion face, front view, big sparkly eyes, brown smooth fur, long whiskers, wet black nose, soft rounded shapes, adorable playful expression, white background, no frame, no text, head only",
    "ReticulatedGiraffe": "Cute kawaii giraffe face, front view, big sparkly eyes, orange-brown spotted pattern, small horns on top, long eyelashes, soft rounded shapes, adorable gentle expression, white background, no frame, no text, head only",
    "Cheetah": "Cute kawaii cheetah face, front view, big sparkly eyes, golden fur with spots, black tear-line markings from eyes, small rounded ears, soft rounded shapes, adorable expression, white background, no frame, no text, head only",
    "AfricanElephant": "Cute kawaii african elephant face, front view, big sparkly eyes, grey skin, very large floppy ears, long trunk, small tusks, soft rounded shapes, adorable gentle expression, white background, no frame, no text, head only",
    "SouthernWhiteRhino": "Cute kawaii rhinoceros face, front view, big sparkly eyes, grey skin, two horns on nose, wide mouth, soft rounded shapes, adorable calm expression, white background, no frame, no text, head only",
    "BottlenoseDolphin": "Cute kawaii bottlenose dolphin face, front view, big sparkly eyes, blue-grey smooth skin, curved smile mouth, rounded forehead, soft rounded shapes, adorable friendly expression, white background, no frame, no text, head only",
}


def generate_one(client, name, prompt):
    print(f"[{name}] Generating...")
    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=prompt)],
        ),
    ]
    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level="MINIMAL"),
        image_config=types.ImageConfig(image_size="1K"),
        response_modalities=["IMAGE", "TEXT"],
    )

    for chunk in client.models.generate_content_stream(
        model="gemini-3.1-flash-image-preview",
        contents=contents,
        config=config,
    ):
        if chunk.parts is None:
            continue
        if chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
            inline_data = chunk.parts[0].inline_data
            ext = mimetypes.guess_extension(inline_data.mime_type) or ".png"
            out_path = os.path.join(OUTPUT_DIR, f"{name}_face{ext}")
            with open(out_path, "wb") as f:
                f.write(inline_data.data)
            print(f"[{name}] Saved: {out_path}")
            return out_path
        elif hasattr(chunk, "text") and chunk.text:
            print(f"[{name}] Text: {chunk.text}")

    print(f"[{name}] No image generated")
    return None


def main():
    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        print("ERROR: GOOGLE_AI_API_KEY not found in .env")
        return

    client = genai.Client(api_key=api_key)

    results = []
    for name, prompt in ANIMALS.items():
        path = generate_one(client, name, prompt)
        results.append((name, path))
        time.sleep(2)  # レート制限回避

    print("\n=== Results ===")
    ok = sum(1 for _, p in results if p)
    print(f"OK: {ok} / FAIL: {len(results) - ok} / Total: {len(results)}")
    for name, path in results:
        status = "OK" if path else "FAIL"
        print(f"  {name}: {status}")


if __name__ == "__main__":
    main()
