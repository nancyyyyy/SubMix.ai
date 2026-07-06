import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { OUTPUT_DIR } from '@/lib/render';

// /api/render writes rendered clips here; this route is the only way
// the browser can fetch them back out as a downloadable URL.
export const runtime = 'nodejs';

const FILENAME_REGEX = /^[a-f0-9-]+-(vertical|square|horizontal)\.mp4$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;

  if (!FILENAME_REGEX.test(filename)) {
    return NextResponse.json({ status: 'error', error: 'Invalid filename' }, { status: 400 });
  }

  const filePath = path.join(OUTPUT_DIR, filename);

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ status: 'error', error: 'File not found' }, { status: 404 });
  }

  const stream = createReadStream(filePath);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(chunk as Uint8Array));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
