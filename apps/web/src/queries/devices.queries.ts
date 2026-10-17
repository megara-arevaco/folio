import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDeviceBook,
  fetchDeviceDiagnostics,
  fetchEbookDevices,
  uploadDeviceBook,
} from "../services/devices";

export const deviceQueryKeys = {
  all: ["devices"] as const,
  list: ["devices", "list"] as const,
  diagnostics: ["devices", "diagnostics"] as const,
};

export function useEbookDevicesQuery() {
  return useQuery({
    queryKey: deviceQueryKeys.list,
    queryFn: fetchEbookDevices,
  });
}

export function useDeviceDiagnosticsQuery() {
  return useQuery({
    queryKey: deviceQueryKeys.diagnostics,
    queryFn: () => fetchDeviceDiagnostics().catch(() => null),
  });
}

export type DeviceBookReference = { deviceId: string; path: string };

export function useDeleteDeviceBooksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (books: DeviceBookReference[]) => {
      const failures: string[] = [];

      for (const book of books) {
        try {
          await deleteDeviceBook(book.deviceId, book.path);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "");
        }
      }

      return failures;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deviceQueryKeys.list }),
        queryClient.invalidateQueries({ queryKey: deviceQueryKeys.diagnostics }),
      ]);
    },
  });
}

export function useUploadDeviceBooksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ deviceId, files }: { deviceId: string; files: File[] }) => {
      const failures: { fileName: string; message: string }[] = [];
      let uploaded = 0;

      for (const file of files) {
        try {
          await uploadDeviceBook(deviceId, file);
          uploaded += 1;
        } catch (error) {
          failures.push({
            fileName: file.name,
            message: error instanceof Error ? error.message : "",
          });
        }
      }

      return { uploaded, failures };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deviceQueryKeys.list }),
        queryClient.invalidateQueries({ queryKey: deviceQueryKeys.diagnostics }),
      ]);
    },
  });
}
