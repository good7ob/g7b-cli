import axios from 'axios';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Save a signed address to a local file. The address already carries its own authorization, so no API key is sent;
 * only https is followed. The file is created exclusively: an existing one is never touched, and a partial file this
 * call created is removed when the transfer fails.
 */
export async function saveUrlTo(url: string, dest: string): Promise<number> {
  if (!/^https:\/\//i.test(url)) throw new Error('下载地址不是 https，已拒绝');
  // exclusive create first: if the file already exists this throws before anything could be cleaned up
  const fd = fs.openSync(dest, 'wx');
  try {
    const response = await axios.get(url, { responseType: 'stream', maxRedirects: 3, timeout: 10 * 60 * 1000 });
    await pipeline(response.data, fs.createWriteStream(dest, { fd, autoClose: true }));
  } catch (error) {
    fs.rmSync(dest, { force: true });
    throw error;
  }
  return fs.statSync(dest).size;
}
