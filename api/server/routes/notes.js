const express = require('express');
const {
  createNote,
  getNoteById,
  getUserNotes,
  updateNote,
  deleteNote,
  searchNotes,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const notePayloadLimit = express.json({ limit: '1mb' });

router.use(requireJwtAuth);

router.get('/', async (req, res) => {
  try {
    const user = req.user.id;
    const tags = req.query.tags ? String(req.query.tags).split(',').filter(Boolean) : undefined;
    if (req.query.q) {
      const notes = await searchNotes({ user, query: String(req.query.q), tags });
      return res.json({ notes });
    }
    const notes = await getUserNotes({ user, tags });
    res.json({ notes });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const note = await getNoteById({ user: req.user.id, id: req.params.id });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get note' });
  }
});

router.post('/', notePayloadLimit, async (req, res) => {
  try {
    const { title, content, tags, source } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const note = await createNote({ user: req.user.id, title, content, tags, source });
    res.status(201).json(note);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.patch('/:id', notePayloadLimit, async (req, res) => {
  try {
    const { title, content, tags, addLinks } = req.body;
    const note = await updateNote({
      user: req.user.id,
      id: req.params.id,
      update: { title, content, tags, addLinks },
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteNote({ user: req.user.id, id: req.params.id });
    if (!result.ok) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ ok: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;
