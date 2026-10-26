import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveUrlTo } from '../download';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-dl-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('saveUrlTo', () => {
  it('streams the body to the file, sends no API key, and returns the size', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([Buffer.from('hello '), Buffer.from('world')]) });
    const dest = path.join(dir, 'a.txt');

    const size = await saveUrlTo('https://signed.example/x?sig=1', dest);

    expect(size).toBe(11);
    expect(fs.readFileSync(dest, 'utf8')).toBe('hello world');
    const [, config] = get.mock.calls[0];
    expect(config).toMatchObject({ responseType: 'stream', maxRedirects: 3 });
    expect((config as { headers?: unknown }).headers).toBeUndefined();
  });

  it('refuses anything but https without a request', async () => {
    const get = vi.spyOn(axios, 'get');
    await expect(saveUrlTo('http://signed.example/x', path.join(dir, 'b.txt'))).rejects.toThrow(/https/);
    await expect(saveUrlTo('file:///etc/passwd', path.join(dir, 'c.txt'))).rejects.toThrow(/https/);
    expect(get).not.toHaveBeenCalled();
  });

  it('never overwrites an existing file, and removes a partial file when the transfer breaks', async () => {
    const existing = path.join(dir, 'keep.txt');
    fs.writeFileSync(existing, 'old');
    vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([Buffer.from('new')]) });
    await expect(saveUrlTo('https://signed.example/x', existing)).rejects.toThrow();
    expect(fs.readFileSync(existing, 'utf8')).toBe('old');
  });

  it('removes the half-written file when the stream errors', async () => {
    const broken = new PassThrough();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: broken });
    const dest = path.join(dir, 'broken.txt');
    const pending = saveUrlTo('https://signed.example/x', dest);
    broken.write('partial');
    setImmediate(() => broken.destroy(new Error('connection reset')));

    await expect(pending).rejects.toThrow('connection reset');
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('with force it replaces the file only after the whole body arrived', async () => {
    const existing = path.join(dir, 'replace.txt');
    fs.writeFileSync(existing, 'old');
    vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([Buffer.from('brand new')]) });

    const size = await saveUrlTo('https://signed.example/x', existing, true);

    expect(size).toBe(9);
    expect(fs.readFileSync(existing, 'utf8')).toBe('brand new');
    expect(fs.readdirSync(dir)).toEqual(['replace.txt']);
  });

  it('with force a broken transfer leaves the old file and no side file', async () => {
    const existing = path.join(dir, 'keep2.txt');
    fs.writeFileSync(existing, 'old');
    const broken = new PassThrough();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: broken });
    const pending = saveUrlTo('https://signed.example/x', existing, true);
    broken.write('partial');
    setImmediate(() => broken.destroy(new Error('connection reset')));

    await expect(pending).rejects.toThrow('connection reset');
    expect(fs.readFileSync(existing, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['keep2.txt']);
  });
});
