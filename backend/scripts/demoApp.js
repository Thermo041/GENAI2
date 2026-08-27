/**
 * Source for a small but realistic Express/Mongoose app, used to seed a demo
 * repository so every CodeWeave feature has real structure to work with:
 * imports, controller -> service -> model call chains, HTTP routes and a test.
 */
export const DEMO_FILES = {
  'README.md': `# newdemo

A tiny Express + Mongoose service used to exercise CodeWeave.

## Layout
- \`src/app.js\` — express app and route mounting
- \`src/routes/user.routes.js\` — HTTP routes
- \`src/controllers/user.controller.js\` — request handling
- \`src/services/user.service.js\` — business logic
- \`src/models/user.model.js\` — mongoose schema
- \`src/middleware/auth.js\` — bearer token guard
- \`tests/user.test.js\` — service tests
`,

  'package.json': `{
  "name": "newdemo",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "4.19.2",
    "mongoose": "8.4.0",
    "jsonwebtoken": "9.0.2"
  },
  "devDependencies": {
    "jest": "29.7.0"
  }
}
`,

  'src/config/db.js': `const mongoose = require('mongoose');

/** Connects to MongoDB using the URI from the environment. */
async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectDatabase };
`,

  'src/models/user.model.js': `const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    credits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.statics.isEmailTaken = async function isEmailTaken(email, excludeId) {
  const existing = await this.findOne({ email, _id: { $ne: excludeId } });
  return Boolean(existing);
};

const User = mongoose.model('User', userSchema);

module.exports = { User };
`,

  'src/services/user.service.js': `const { User } = require('../models/user.model');

/** Creates a user after checking the email is free. */
async function createUser(payload) {
  if (await User.isEmailTaken(payload.email)) {
    throw new Error('Email already taken');
  }
  return User.create(payload);
}

async function getUserById(id) {
  return User.findById(id);
}

async function listUsers(filter = {}) {
  return User.find(filter).limit(50);
}

/** Adds credits to a user's balance. */
async function addCredits(id, amount) {
  const user = await getUserById(id);
  if (!user) throw new Error('User not found');
  user.credits += amount;
  await user.save();
  return user;
}

module.exports = { createUser, getUserById, listUsers, addCredits };
`,

  'src/controllers/user.controller.js': `const userService = require('../services/user.service');

async function postUser(req, res) {
  const user = await userService.createUser(req.body);
  res.status(201).json(user);
}

async function getUser(req, res) {
  const user = await userService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Not found' });
  return res.json(user);
}

async function getUsers(req, res) {
  res.json(await userService.listUsers());
}

async function postCredits(req, res) {
  const user = await userService.addCredits(req.params.id, req.body.amount);
  res.json(user);
}

module.exports = { postUser, getUser, getUsers, postCredits };
`,

  'src/middleware/auth.js': `const jwt = require('jsonwebtoken');

/** Rejects requests without a valid bearer token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Missing token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = { requireAuth };
`,

  'src/routes/user.routes.js': `const express = require('express');
const controller = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/users', requireAuth, controller.getUsers);
router.get('/users/:id', requireAuth, controller.getUser);
router.post('/users', controller.postUser);
router.post('/users/:id/credits', requireAuth, controller.postCredits);

module.exports = router;
`,

  'src/app.js': `const express = require('express');
const userRoutes = require('./routes/user.routes');
const { connectDatabase } = require('./config/db');

const app = express();
app.use(express.json());
app.use('/api', userRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

async function start(port = process.env.PORT || 3000) {
  await connectDatabase();
  return app.listen(port);
}

if (require.main === module) start();

module.exports = { app, start };
`,

  'tests/user.test.js': `const { createUser } = require('../src/services/user.service');

describe('createUser', () => {
  it('rejects a duplicate email', async () => {
    await expect(createUser({ email: 'taken@example.com' })).rejects.toThrow('Email already taken');
  });
});
`,
};
