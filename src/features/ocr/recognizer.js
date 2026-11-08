import { detectGreenBands, detectOptionRows, parseOCR } from './parser.js';

export const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file) {
  if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE) {
    throw new Error('Chọn ảnh JPG, PNG hoặc WebP tối đa 15 MB.');
  }
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không mở được ảnh. Hãy dùng JPG, PNG hoặc WebP.'));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 65_000_000) {
      throw new Error('Ảnh quá lớn. Hãy giảm kích thước rồi tải lại.');
    }
    const scale = Math.min(1, 2200 / image.naturalWidth, 3500 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { canvas, bands: detectGreenBands(pixels), boxes: detectOptionRows(pixels) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One worker per upload batch; release WASM memory when the batch ends. */
export function createRecognizer() {
  let worker;
  let report = () => {};

  async function getWorker() {
    if (!worker) {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('vie', 1, {
        logger: (event) =>
          report({
            message:
              event.status === 'recognizing text'
                ? 'Đang đọc chữ tiếng Việt… ' + Math.round(event.progress * 100) + '%'
                : 'Đang tải bộ đọc chữ cho lần dùng đầu…',
            progress: event.status === 'recognizing text' ? Math.round(event.progress * 85) : 5,
          }),
      });
    }
    return worker;
  }

  async function readBoxes(worker, canvas, boxes) {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { width, height } = canvas;
    const top = Math.floor(height * 0.26);
    const title = await worker.recognize(canvas, {
      rectangle: {
        left: Math.floor(width * 0.02),
        top,
        width: Math.floor(width * 0.96),
        height: Math.max(1, boxes[0].top - top - 8),
      },
    });
    const options = [];
    let confidence = title.data.confidence;
    for (const [index, box] of boxes.entries()) {
      report({
        message: 'Đang đọc lựa chọn ' + String.fromCharCode(65 + index) + '…',
        progress: 30 + Math.round((index / boxes.length) * 50),
      });
      const result = await worker.recognize(canvas, {
        rectangle: {
          left: Math.floor(width * 0.2),
          top: box.top + 10,
          width: Math.floor(width * 0.74),
          height: Math.max(1, box.bottom - box.top - 20),
        },
      });
      options.push(result.data.text.trim().replace(/\s*\n\s*/g, ' '));
      confidence += result.data.confidence;
    }
    if (options.some((option) => !option)) {
      return (await worker.recognize(canvas, {}, { text: true, blocks: true })).data;
    }
    let text =
      title.data.text.trim() +
      '\n' +
      options.map((option, index) => String.fromCharCode(65 + index) + '. ' + option).join('\n');
    const selected = boxes.flatMap((box, index) => (box.selected ? [index] : []));
    if (selected.length === 1) text += '\nĐáp án: ' + String.fromCharCode(65 + selected[0]);
    return { text, confidence: confidence / (boxes.length + 1) };
  }

  return {
    async recognize(file, onProgress = () => {}) {
      validateImage(file);
      report = onProgress;
      const { canvas, bands, boxes } = await prepareImage(file);
      try {
        const worker = await getWorker();
        let data;
        if (boxes.length) data = await readBoxes(worker, canvas, boxes);
        else {
          await worker.setParameters({ tessedit_pageseg_mode: '3' });
          data = (await worker.recognize(canvas, {}, { text: true, blocks: true })).data;
        }
        if (data.text.trim().length < 3)
          throw new Error('Không thấy chữ trong ảnh. Hãy thử ảnh rõ hơn, chụp thẳng và đủ sáng.');
        const questions = parseOCR(data, bands);
        if (!questions.length) throw new Error('Chưa đọc được nội dung. Hãy thử ảnh rõ hơn.');
        return { rawText: data.text, questions };
      } finally {
        canvas.width = canvas.height = 1;
        report = () => {};
      }
    },
    async close() {
      const current = worker;
      worker = null;
      if (current) await current.terminate();
    },
  };
}
