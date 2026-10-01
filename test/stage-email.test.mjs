// EMAIL_FROM hygiene: the From header must never carry a pasted line break.
import test from "node:test";
import assert from "node:assert/strict";
import { emailFrom, EMAIL_FROM_DEFAULT } from "../src/stage-email.js";

test("emailFrom trims a trailing newline from the secret", () => {
  assert.equal(emailFrom({ EMAIL_FROM: "Exor Games <customerservice@exorgames.com>\n" }), "Exor Games <customerservice@exorgames.com>");
  assert.equal(emailFrom({ EMAIL_FROM: "  Exor Games <customerservice@exorgames.com>\r\n" }), "Exor Games <customerservice@exorgames.com>");
});

test("emailFrom falls back to the default when the secret is blank or missing", () => {
  assert.equal(emailFrom({ EMAIL_FROM: "\n" }), EMAIL_FROM_DEFAULT);
  assert.equal(emailFrom({}), EMAIL_FROM_DEFAULT);
  assert.equal(emailFrom(undefined), EMAIL_FROM_DEFAULT);
});
