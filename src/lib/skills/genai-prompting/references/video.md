# Video Prompting — I2V & T2V Reference

## Image-to-Video (I2V) — Motion Prompts

**Golden Rule:** The source image IS frame one. Do NOT re-describe the scene. Describe ONLY:
- What moves
- Camera behavior
- Audio landscape
- Pacing/timing

**Structure:** `[Camera behavior] + [Subject action with timing] + [Audio] + [Pacing]`

### Static Camera Escalation

When you need the camera to NOT move, escalate specificity as needed:
- Level 1: `The camera remains static`
- Level 2: `Fixed tripod shot with absolutely no camera movement`
- Level 3: `LOCKED STATIC FRAME: Camera mounted on heavy tripod, does not move, pan, tilt, zoom, or drift throughout entire sequence`

### Audio Design

Audio matters, especially for newer models. Be specific, not vague.

**Avoid:** "ambient sounds", "background noise"
**Use:** "ceramic mug placed on wooden surface (soft clink)", "distant traffic hum with occasional horn"

**Dialogue format:** `A man murmurs, 'This must be it.'`

### Example

```
Camera locked on tripod, completely static. The person slowly raises the coffee cup to their lips, takes a small sip, then lowers it. Eyes remain fixed on laptop screen. Steam rises continuously from cup. Real-time pacing. Audio: quiet office ambience, distant keyboard typing, soft cup contact with desk.
```

---

## Text-to-Video (T2V)

Combine T2I structure with motion/audio elements:

**Structure:** Style + Subject + Environment + Camera + Actions + Audio + Performance quality

### Example

```
Photorealistic 4K documentary footage of a barista with brown hair tied back, wearing a gray apron, standing behind an espresso machine in a minimalist cafe. Camera locked on tripod at chest height. She reaches for the portafilter, taps it twice against the knock box (sharp knocking sounds), locks it into the group head with a quarter turn (mechanical click). Steam flows as espresso drips into white ceramic cup. Constant natural morning light. Authentic extraction sounds and ambient chatter. Understated professional performance.
```

---

## Timing & Pacing

- Specify real-time vs. slow-motion explicitly
- For short clips (5–10s), describe 1–2 actions maximum
- For longer clips, break into beats: "First 3 seconds: [action]. Then: [action]. Final moment: [action]."
- Avoid cramming too many actions — models struggle with complex choreography in a single generation
