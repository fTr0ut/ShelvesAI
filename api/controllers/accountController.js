const User = require('../models/User');

async function getAccount(req, res) {
  const user = await User.findById(req.user.id).select(
    '_id username email name picture firstName lastName phoneNumber country city state isPrivate'
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
}

async function updateAccount(req, res) {
  const allowed = ['firstName', 'lastName', 'phoneNumber', 'country', 'city', 'state', 'isPrivate', 'name', 'picture'];
  const updates = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      updates[key] = req.body[key];
    }
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  Object.assign(user, updates);
  await user.save();

  const response = {
    _id: user._id,
    username: user.username,
    email: user.email,
    name: user.name,
    picture: user.picture,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneNumber: user.phoneNumber,
    country: user.country,
    city: user.city,
    state: user.state,
    isPrivate: user.isPrivate,
  };

  res.json({ user: response });
}

module.exports = { getAccount, updateAccount };
