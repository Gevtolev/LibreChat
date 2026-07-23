const denyGuestRole = require('./denyGuestRole');

function createMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('denyGuestRole', () => {
  it('calls next() when there is no user on the request', () => {
    const next = jest.fn();
    denyGuestRole({}, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() for a non-GUEST role', () => {
    const next = jest.fn();
    denyGuestRole({ user: { role: 'USER' } }, createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 for the GUEST role and does not call next()', () => {
    const next = jest.fn();
    const res = createMockRes();
    denyGuestRole({ user: { role: 'GUEST' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});
