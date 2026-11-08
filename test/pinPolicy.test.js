const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pinProblem } = require('../utils/pin');
const userController = require('../controllers/userController');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('pinProblem', () => {
  it('accepts 6 to 8 digit non-trivial PINs', () => {
    assert.equal(pinProblem('482916'), null);
    assert.equal(pinProblem('90417263'), null);
    assert.equal(pinProblem(482916), null);
  });

  it('rejects short and long PINs', () => {
    assert.match(pinProblem('1234'), /6 to 8/);
    assert.match(pinProblem('123456789'), /6 to 8/);
  });

  it('rejects non-digits', () => {
    assert.match(pinProblem('12ab56'), /digits only/);
    assert.match(pinProblem('12 456'), /digits only/);
    assert.match(pinProblem({}), /digits only/);
  });

  it('rejects repeated digits and sequences', () => {
    assert.match(pinProblem('111111'), /repeated/);
    assert.match(pinProblem('123456'), /sequence/);
    assert.match(pinProblem('654321'), /sequence/);
  });
});

describe('createUser PIN policy', () => {
  it('returns 400 for a weak PIN before touching storage', async () => {
    for (const pin of ['1234', '111111', '123456', 'abcdef']) {
      const res = mockRes();
      await userController.createUser(
        {
          body: { username: 'new.teller', email: 'new.teller@example.com', password: 'Passw0rd!x', role: 'TELLER', pin },
          user: { role: 'ADMIN', tenantId: 1 },
        },
        res
      );
      assert.equal(res.statusCode, 400, `pin ${pin}`);
      assert.match(res.body.error, /PIN/);
    }
  });
});
