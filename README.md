# WristCam

Phone-camera golf wrist trainer. Set the phone up down the line (or face on), swing, and hear a beep when your lead wrist is out of your target range at P2, P3, the top (P4) and through the downswing and follow-through.

Live builds (GitHub Pages, HTTPS):
- Staging: **https://mquangt.github.io/wristcam/staging/**
- Production: **https://mquangt.github.io/wristcam/** (once `main` is deployed)

## How it works

- **MediaPipe Pose** (body, every frame) + **MediaPipe Hands** (run on a crop around the wrist) in the browser. No server, nothing uploaded.
- **Wrist angles** (`app/js/wrist-math.js`): flexion/extension is the hand's rotation about the knuckle line relative to the forearm (+ extension/cupped, − flexion/bowed); radial/ulnar deviation (hinge) is the tilt toward the thumb. Same sign conventions HackMotion uses.
- **Positions** (`app/js/swing-detector.js`): the club isn't tracked, so P-positions come from the lead arm angle (0° hanging, 90° parallel to the ground): address = still with arms low; P2/P3 = thresholds going back; top = peak; P5/P6 = thresholds coming down; impact = lowest point; P8 = threshold going through; finish = still again.
- **Modes**: *Drill* gives continuous beeps while you rehearse slowly or hold a position (auto-picks P1–P4 from arm angle, or a fixed position). *Swing* beeps at the moment each checked position is reached in a full swing, shows a results table, can speak a summary, and keeps a slow-mo replay.
- **Sound**: beep when out of range (or when in range), directional pitch (high double-beep = too cupped / too much, low beep = too bowed / too little), different timbres for wrist / hinge / arm bend, optional voice.
- **Configurable**: right/left-handed, lead or trail wrist, presets (neutral, bowed, cupped), per-position on/off and min/max for each metric, "Set target from this position" capture, calibration offsets, model size, detection thresholds. Saved on the phone.
- **Analyze a video**: pick a swing video recorded with the phone's camera app (high frame rate/slo-mo works best); it runs at 0.25–1× speed.

## Limits

A single phone camera at full swing speed is blurry and 30–60 fps, and monocular 3D is approximate, so absolute degrees won't match a wrist sensor. Treat the presets as starting points, and calibrate with the capture button or the offsets.

## Develop

```bash
npm run dev     # http://localhost:5174 (camera works on localhost)
npm test        # unit tests for the math and swing detector
```

## Deploy

GitHub Pages serves the `gh-pages` branch: production at the root, staging under `/staging/`.

```bash
npm run deploy:staging      # from the staging branch
npm run deploy:production   # from main
```

Then push the branch itself (`git push origin staging` / `git push origin main`). Pages updates in about a minute.
