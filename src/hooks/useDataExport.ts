import { Alert, Share, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { reportError } from '../lib/crashReporting';
import { useTranslation } from 'react-i18next';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useTransfersStore } from '../stores/transfersStore';
import { useProductCatalogStore } from '../stores/productCatalogStore';
import { FREQUENCY_LABELS, Frequency } from '../constants/products';
import { parseDate } from '../utils/helpers';

interface ExportUser {
  uid: string;
  email: string;
}

const escapeCsv = (val: string | number | boolean | undefined | null): string => {
  let str = String(val ?? '');
  // Neutralizar inyección de fórmulas: Excel/Sheets ejecutan celdas que
  // empiezan con = + - @ (un nombre/nota malicioso podría colar un
  // =HYPERLINK). El apóstrofe inicial las fuerza a texto plano.
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

const shareFile = async (content: string, filename: string) => {
  const dir = Platform.OS === 'ios' ? RNFS.TemporaryDirectoryPath : RNFS.CachesDirectoryPath;
  const filePath = `${dir}/${filename}`;
  await RNFS.writeFile(filePath, content, 'utf8');
  const fileUrl = Platform.OS === 'ios' ? filePath : `file://${filePath}`;
  await Share.share(
    Platform.OS === 'ios'
      ? { url: fileUrl }
      : { title: filename, message: content },
  );
};

export const useDataExport = (user: ExportUser) => {
  const { t } = useTranslation();
  const clients = useClientsStore((s) => s.clients);
  const debts = useDebtsStore((s) => s.debts);
  const transfers = useTransfersStore((s) => s.transfers);
  // Mismo criterio que el badge de la UI: la deuda se deriva en vivo de la
  // colección (agregando duplicados por nombre+teléfono), no del flag
  // persistido c.hasDebt, que puede quedar desincronizado (p. ej. deuda
  // creada desde la webapp o instancia duplicada creada después de la deuda).
  const getClientDebtTotal = useDebtsStore((s) => s.getClientDebtTotal);

  const handleExportCSV = async () => {
    try {
      // Las notas sueltas (isNote) no son clientes: salían como filas "NOTA".
      const allClients = clients.filter((c) => c.name && !c.isNote);
      if (allClients.length === 0) {
        Alert.alert(t('settings.noDataCSV'), t('settings.noClientsToExport'));
        return;
      }

      const headers = ['Nombre', 'Teléfono', 'Dirección', 'Día', 'Frecuencia', 'Productos', 'Notas', 'Tiene Deuda', 'Favorito', 'Link Maps'];

      const products = useProductCatalogStore.getState().allProducts;
      const rows = allClients.map((c) => {
        // Build product summary with labels (matching webapp)
        const prodParts: string[] = [];
        if (c.products) {
          products.forEach((p) => {
            const qty = parseInt(String(c.products[p.id] || 0), 10);
            if (qty > 0) prodParts.push(`${p.label}: ${qty}`);
          });
        }

        return [
          escapeCsv(c.name),
          escapeCsv(c.phone),
          escapeCsv(c.address),
          // visitDays primero: un cliente multi-día exportaba un solo día
          // (visitDay siempre está seteado y ganaba la precedencia).
          escapeCsv((c.visitDays && c.visitDays.length > 0) ? c.visitDays.join(' / ') : (c.visitDay || '')),
          escapeCsv(FREQUENCY_LABELS[c.freq as Frequency] || c.freq || ''),
          escapeCsv(prodParts.join(', ')),
          escapeCsv(c.notes || ''),
          getClientDebtTotal(c.id) > 0 ? 'Sí' : 'No',
          c.isStarred ? 'Sí' : 'No',
          escapeCsv(c.mapsLink || ''),
        ].join(',');
      });

      // BOM for Excel/Sheets UTF-8 recognition
      const bom = '﻿';
      const csvContent = bom + headers.map(escapeCsv).join(',') + '\n' + rows.join('\n');

      const date = new Date().toISOString().split('T')[0];
      await shareFile(csvContent, `RutaWater_Clientes_${date}.csv`);

      Alert.alert(t('settings.csvExported', { count: allClients.length }), '');
    } catch (e) {
      reportError(e, 'Error exporting CSV');
      Alert.alert(t('error'), t('settings.exportError'));
    }
  };

  const handleExportJSON = async () => {
    try {
      const allClients = clients.filter((c) => c.name);
      if (allClients.length === 0 && debts.length === 0 && transfers.length === 0) {
        Alert.alert(t('settings.noDataCSV'), t('settings.noDataToExport'));
        return;
      }

      const backup = {
        exportDate: new Date().toISOString().split('T')[0],
        exportedBy: user.email || user.uid,
        clients: allClients.map((c) => ({
          id: c.id, name: c.name, phone: c.phone || '', address: c.address || '',
          lat: c.lat || '', lng: c.lng || '', freq: c.freq || '',
          visitDay: c.visitDay || '', visitDays: c.visitDays || [],
          specificDate: c.specificDate || '', notes: c.notes || '',
          products: c.products || {}, isStarred: c.isStarred || false,
          alarm: c.alarm || '', mapsLink: c.mapsLink || '', isNote: c.isNote || false,
          hasDebt: getClientDebtTotal(c.id) > 0,
          // Estado de ciclo y orden de ruta: sin estos campos el backup no
          // permitía restaurar qué se entregó ni el orden de cada día.
          isCompleted: c.isCompleted || false,
          isInactive: c.isInactive || false,
          lastVisited: parseDate(c.lastVisited)?.toISOString() || '',
          completedAt: parseDate(c.completedAt)?.toISOString() || '',
          doneFor: c.doneFor || '',
          listOrder: c.listOrder ?? 0,
          listOrders: c.listOrders || {},
          relationships: c.relationships || {},
        })),
        debts: debts.map((d) => ({
          id: d.id, clientId: d.clientId, clientName: d.clientName || '',
          clientAddress: (d as any).clientAddress || '', amount: d.amount || 0,
          createdAt: parseDate(d.createdAt)?.toISOString() || '',
        })),
        transfers: transfers.map((t) => ({
          id: t.id, clientId: t.clientId, clientName: t.clientName || '',
          clientAddress: (t as any).clientAddress || '',
          createdAt: parseDate(t.createdAt)?.toISOString() || '',
        })),
      };

      const jsonContent = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().split('T')[0];
      await shareFile(jsonContent, `RutaWater_Backup_${date}.json`);

      const counts: string[] = [];
      if (backup.clients.length > 0) counts.push(t('settings.backupClients', { count: backup.clients.length }));
      if (backup.debts.length > 0) counts.push(t('settings.backupDebts', { count: backup.debts.length }));
      if (backup.transfers.length > 0) counts.push(t('settings.backupTransfers', { count: backup.transfers.length }));
      Alert.alert(t('settings.backupReady'), counts.join(', '));
    } catch (e) {
      reportError(e, 'Error exporting JSON');
      Alert.alert(t('error'), t('settings.exportError'));
    }
  };

  return { handleExportCSV, handleExportJSON };
};
