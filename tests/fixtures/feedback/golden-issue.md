[feedback] eclipse: The grade passed a Plum draw with the strap on the ear. @​someone look at #​12…

### What happened
The grade passed a Plum draw with the strap on the ear. @​someone look at #​12 &lt;!-- not a marker --&gt;

### What should have happened
B3 should have failed it.

### Example
- https://loop.frontify.com/document/1#/assets/42

### Claude's reading
Looks like B3, the strap position.
Check: B3, wrong size on the head, or the strap stops at the ear (confirmed by the reporter).

### Where
- Plugin: creative 0.2.0 (kit 0123456) · Skill: eclipse · Surface: chat · Date: 2026-09-24
- Vesper: output out-123

### Reported by
Test Designer designer@loop.example via Vesper

<!-- loop-creative-feedback v1 -->
```json
{
 "schema": 1,
 "target": "eclipse",
 "kind": "remark",
 "check": "B3",
 "check_confirmed": true,
 "words": "The grade passed a Plum draw with the strap on the ear. @someone look at #12 <!-- not a marker -->",
 "what_should_have_happened": "B3 should have failed it.",
 "example": null,
 "claudes_reading": "Looks like B3, the strap position.",
 "links": [
  "https://loop.frontify.com/document/1#/assets/42"
 ],
 "reporter": {
  "name": "Test Designer",
  "email": "designer@loop.example",
  "profile_id": "11111111-1111-4111-8111-111111111111"
 },
 "plugin_version": "0.2.0",
 "kit_commit": "0123456789abcdef0123456789abcdef01234567",
 "surface": "chat",
 "asked_at": "2026-09-24T10:00:00.000Z",
 "joins": null,
 "vesper": {
  "output_id": "out-123",
  "grade_id": null
 }
}
```
