const User = require("../models/user");

exports.createOrUpdateUser = async (req, res) => {
  const { name, picture, email } = req.user;

  // The name is only set on first sign-in, so a name saved in the profile stays.
  const user = await User.findOneAndUpdate({ email }, { picture }, { new: true });
  if (user) {
    res.json(user);
  } else {
    const newUser = await new User({
      email,
      name: email.split("@")[0],
      picture,
    }).save();
    res.json(newUser);
  }
};

exports.currentUser = async (req, res) => {
  // Mongoose 7+ no longer accepts callbacks. A query error used to be thrown
  // from the callback; it now rejects this handler and is logged by the
  // process-level unhandledRejection handler in server.js.
  const user = await User.findOne({ email: req.user.email }).exec();
  res.json(user);
};
