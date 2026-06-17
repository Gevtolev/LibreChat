import noteSchema from '~/schema/note';
import type { INote } from '~/types/note';

export function createNoteModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.Note || mongoose.model<INote>('Note', noteSchema);
}
