# The README's demo

The first picture on the repository page is an **animated WebP**, `screenshots/demo.webp`: the whole
recording, 66 seconds, 1200 px wide, 10 frames a second, 24-bit colour, looped and silent. A preview that
skips the interesting seconds is a preview of nothing, so the length is the recording's own.

GitHub draws it like any other image, served from the repository itself (`/raw/main/screenshots/demo.webp`,
`image/webp`, cached five minutes). A file committed here therefore never meets the image proxy — neither
its size ceiling nor its one-year cache below apply to it.

Why not a GIF: the palette is 256 colours, which bands a dark interface, and the frame rate has to stay low
because every frame carries its own pixels. The WebP that replaced it runs at three times the frame rate and
1.5 times the width, in full colour, and weighs less than the GIF it replaced. Why not a video: the markup
sanitizer strips `autoplay`, `loop` and `playsinline` from a `<video>`, so it renders as a player waiting for
a click, while an image starts on its own.

## The recipe

Two steps, frames then the animation. `ffmpeg` has no WebP encoder here, so `img2webp` comes from
`brew install webp`.

```bash
# the whole video at 10 frames a second, 1200 px wide (the height follows, -2 keeps it even)
ffmpeg -i demo.mp4 -vf "fps=10,scale=1200:-2" frames/f%05d.png

# the animation; -lossy is NOT the default, and -q means nothing without it
img2webp -loop 0 -m 6 -lossy -q 60 -d 100 frames/*.png -o demo.webp
```

The weight of the file as committed is what `ls -l screenshots/demo.webp` prints.

Four things worth knowing before redoing it:

- **`-lossless` is the default of `img2webp`, and `-q` is ignored until `-lossy` is given.** Without it the
  same frames come out about three times heavier, and quality looks like a flag that does nothing.
- **The lever is the frame rate, not the quality.** At a fixed rate, quality moved the weight by a few per
  cent; halving the frames nearly halved the file. What the encoder cannot do is drop frames: a frame whose
  every pixel changed has to be sent whole.
- **Record for it, or start from the recording itself.** Encoding from the 30 fps H.264 export costs more
  than encoding from the original capture: the export's compression noise differs frame to frame, so the
  encoder can neither crop a changed rectangle nor merge two identical frames.
- **`-m 6` is slow** — minutes per variant on a 66-second recording — so measure on a short cut of the same
  material and spend the slow pass once, on the winner.

Measured while choosing, on the recording this picture came from, 1200 px wide, with the full length kept:

| encode | weight |
|---|---|
| 15 fps, lossless | 25,2 MB |
| 15 fps, lossy, q75 | 7,9 MB |
| 10 fps, lossy, q75 | 6,1 MB |
| **10 fps, lossy, q60** (in use) | **4,9 MB** |
| 5 fps, lossy, q75 | 3,6 MB |
| 3 fps, lossy, q80 | 3,4 MB |

## Hosting it outside the repository

A picture this size is affordable in a repository once and never changed. A longer or heavier one belongs on
the owner's own domain, as another plugin's README does: the image is then fetched through GitHub's image
proxy, which returns the bytes untouched and **caches by URL for a year**. Two consequences — a new version
needs a new file name, or the old picture is what everybody keeps seeing; and the proxy's size ceiling is
undocumented, so the first upload is checked on the rendered page, where an oversized image is a broken
icon rather than an error.
