import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/project';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ status: 'error', error: `Project not found: ${projectId}` }, { status: 404 });
  }

  return NextResponse.json({ status: 'success', project });
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// Updates exactly one word's text, identified by its position in the
// segments/words arrays. Start/end timestamps for that word (and every
// other word) are copied over untouched, so an edit here can never drift
// the timing a render burns into video.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { segmentIndex, wordIndex, newText } = (body ?? {}) as {
    segmentIndex?: unknown;
    wordIndex?: unknown;
    newText?: unknown;
  };

  if (!isNonNegativeInt(segmentIndex) || !isNonNegativeInt(wordIndex) || typeof newText !== 'string') {
    return NextResponse.json(
      {
        status: 'error',
        error: 'segmentIndex and wordIndex must be non-negative integers and newText must be a string',
      },
      { status: 400 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ status: 'error', error: `Project not found: ${projectId}` }, { status: 404 });
  }

  const segment = project.segments[segmentIndex];
  if (!segment || !segment.words[wordIndex]) {
    return NextResponse.json(
      { status: 'error', error: 'segmentIndex/wordIndex is out of range for this project' },
      { status: 400 }
    );
  }

  const segments = project.segments.map((s, si) => {
    if (si !== segmentIndex) return s;
    return {
      ...s,
      words: s.words.map((w, wi) => (wi === wordIndex ? { ...w, word: newText } : w)),
    };
  });

  const updated = await updateProject(projectId, { segments });
  return NextResponse.json({ status: 'success', project: updated });
}
