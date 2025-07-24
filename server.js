const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// JWT secret
const JWT_SECRET = 'flqween_secret_key';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// Auth endpoints (very simple, no password hashing for demo)
app.post('/api/register', (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) return res.status(400).json({ error: 'username and email required' });
  const user = { id: uuid(), username, email, avatar: '', bio: '', links: [], uploads: 0, followers: 0, following: 0, totalLikes: 0 };
  prisma.user.create({ data: user }).then(createdUser => {
    const token = jwt.sign({ id: createdUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: createdUser, token });
  }).catch(e => {
    if (e.code === 'P2002') { // Unique constraint violation
      res.status(400).json({ error: 'email exists' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  });
});

app.post('/api/login', (req, res) => {
  const { email } = req.body;
  prisma.user.findUnique({ where: { email } }).then(user => {
    if (!user) return res.status(404).json({ error: 'user not found' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user, token });
  }).catch(e => {
    res.status(500).json({ error: 'Login failed' });
  });
});

// Middleware проверки токена
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'token missing' });
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token invalid' });
  }
}

// Profile update
app.put('/api/profile/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { bio, links, avatar } = req.body;
  prisma.user.findUnique({ where: { id } }).then(user => {
    if (!user) return res.status(404).json({ error: 'not found' });
    if (bio !== undefined) user.bio = bio;
    if (links !== undefined) user.links = links;
    if (avatar !== undefined) user.avatar = avatar;
    prisma.user.update({ where: { id }, data: user }).then(updatedUser => {
      res.json(updatedUser);
    }).catch(e => {
      res.status(500).json({ error: 'Profile update failed' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Profile update failed' });
  });
});

// Content upload
app.post('/api/content', authMiddleware, upload.fields([{ name: 'files' }, { name: 'cover' }, { name: 'screenshots' }]), (req, res) => {
  const { title, description, tags, price, authorId, type } = req.body;
  prisma.user.findUnique({ where: { id: authorId } }).then(author => {
    if (!author) return res.status(400).json({ error: 'invalid author' });
    const content = {
      id: uuid(),
      title,
      description,
      tags: tags ? JSON.parse(tags) : [],
      price: Number(price),
      type,
      authorId,
      likes: 0,
      downloads: 0,
      createdAt: Date.now(),
      thumbnail: req.files['cover'] ? `/uploads/${req.files['cover'][0].filename}` : '',
      screenshots: req.files['screenshots'] ? req.files['screenshots'].map(f => `/uploads/${f.filename}`) : [],
      filePaths: req.files['files'].map(f => `/uploads/${f.filename}`)
    };
    prisma.content.create({ data: content }).then(createdContent => {
      author.uploads += 1;
      prisma.user.update({ where: { id: authorId }, data: author }).then(() => {
        res.json(createdContent);
      }).catch(e => {
        res.status(500).json({ error: 'Content upload failed' });
      });
    }).catch(e => {
      res.status(500).json({ error: 'Content upload failed' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Content upload failed' });
  });
});

// Content list
app.get('/api/content', (req, res) => {
  prisma.user.findMany().then(users => {
    prisma.content.findMany().then(content => {
      const list = content.map(c => ({
        ...c,
        author: users.find(u => u.id === c.authorId) || null
      }));
      res.json(list);
    }).catch(e => {
      res.status(500).json({ error: 'Failed to fetch content' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Failed to fetch users' });
  });
});

// Posts
app.post('/api/posts', authMiddleware, (req, res) => {
  const { text } = req.body;
  const authorId = req.userId;
  prisma.user.findUnique({ where: { id: authorId } }).then(author => {
    if (!author) return res.status(400).json({ error: 'invalid author' });
    const post = { id: uuid(), text, authorId, createdAt: Date.now(), likes: 0 };
    prisma.post.create({ data: post }).then(createdPost => {
      res.json(createdPost);
    }).catch(e => {
      res.status(500).json({ error: 'Post creation failed' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Post creation failed' });
  });
});

app.get('/api/posts', (req, res) => {
  prisma.user.findMany().then(users => {
    prisma.post.findMany().then(posts => {
      const list = posts.map(p => ({
        ...p,
        author: users.find(u => u.id === p.authorId) || null
      }));
      res.json(list);
    }).catch(e => {
      res.status(500).json({ error: 'Failed to fetch posts' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Failed to fetch users' });
  });
});

// Users list
app.get('/api/users', (req, res) => {
  prisma.user.findMany().then(users => {
    res.json(users);
  }).catch(e => {
    res.status(500).json({ error: 'Failed to fetch users' });
  });
});

// Single user profile
app.get('/api/profile/:id', (req, res) => {
  prisma.user.findUnique({ where: { id: req.params.id } }).then(user => {
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  }).catch(e => {
    res.status(500).json({ error: 'Failed to fetch user' });
  });
});

// Лайк контента
app.post('/api/content/:id/like', authMiddleware, (req, res) => {
  const { id } = req.params;
  prisma.content.findUnique({ where: { id } }).then(content => {
    if (!content) return res.status(404).json({ error: 'not found' });
    if (!content.likedBy) content.likedBy = [];
    if (content.likedBy.includes(req.userId)) return res.json(content);
    content.likedBy.push(req.userId);
    content.likes += 1;
    prisma.content.update({ where: { id }, data: content }).then(updatedContent => {
      res.json(updatedContent);
    }).catch(e => {
      res.status(500).json({ error: 'Like update failed' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Like update failed' });
  });
});

// Подписка
app.post('/api/users/:id/follow', authMiddleware, (req, res) => {
  const { id } = req.params;
  prisma.user.findUnique({ where: { id } }).then(user => {
    prisma.user.findUnique({ where: { id: req.userId } }).then(me => {
      if (!user || !me) return res.status(404).json({ error: 'not found' });
      if (user.id === me.id) return res.status(400).json({ error: 'cannot follow self' });
      if (!user.followersList) user.followersList = [];
      if (!me.followingList) me.followingList = [];
      if (user.followersList.includes(me.id)) return res.json({ ok: true });
      user.followersList.push(me.id);
      me.followingList.push(user.id);
      user.followers += 1;
      me.following += 1;
      prisma.user.update({ where: { id }, data: user }).then(() => {
        prisma.user.update({ where: { id: req.userId }, data: me }).then(() => {
          res.json({ ok: true });
        }).catch(e => {
          res.status(500).json({ error: 'Follow update failed' });
        });
      }).catch(e => {
        res.status(500).json({ error: 'Follow update failed' });
      });
    }).catch(e => {
      res.status(500).json({ error: 'Follow update failed' });
    });
  }).catch(e => {
    res.status(500).json({ error: 'Follow update failed' });
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`)); 