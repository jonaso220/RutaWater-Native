import { Platform, Share } from 'react-native';
import RNFS from 'react-native-fs';
import {
  errorCodes,
  isErrorWithCode,
  saveDocuments,
} from '@react-native-documents/picker';

export type ExportFileResult = 'saved' | 'cancelled';

/**
 * Exports a real file. Android's core Share API only sends text/plain and
 * reports success as soon as its chooser opens, so backups use the Storage
 * Access Framework instead. That makes the resulting JSON selectable by the
 * existing restore picker and gives us a reliable cancellation signal.
 */
export const exportFile = async (
  content: string,
  filename: string,
  mimeType: string,
): Promise<ExportFileResult> => {
  const directory = Platform.OS === 'ios'
    ? RNFS.TemporaryDirectoryPath
    : RNFS.CachesDirectoryPath;
  const filePath = `${directory}/${filename}`;
  await RNFS.writeFile(filePath, content, 'utf8');

  try {
    if (Platform.OS === 'android') {
      try {
        const savedFiles = await saveDocuments({
          sourceUris: [encodeURI(`file://${filePath}`)],
          mimeType,
          fileName: filename,
        });
        const savedFile = savedFiles[0];
        if (!savedFile) {
          throw new Error('EXPORT_SAVE_FAILED: empty result');
        }
        if (savedFile.error) {
          throw new Error(`EXPORT_SAVE_FAILED: ${savedFile.error}`);
        }
        return 'saved';
      } catch (error) {
        if (
          isErrorWithCode(error) &&
          error.code === errorCodes.OPERATION_CANCELED
        ) {
          return 'cancelled';
        }
        throw error;
      }
    }

    const result = await Share.share({ url: filePath });
    return result.action === Share.dismissedAction ? 'cancelled' : 'saved';
  } finally {
    await RNFS.unlink(filePath).catch(() => {});
  }
};
