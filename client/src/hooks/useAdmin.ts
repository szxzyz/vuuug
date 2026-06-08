import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export type AdminPermission =
  | 'view_stats'
  | 'manage_users'
  | 'manage_withdrawals'
  | 'manage_tasks'
  | 'manage_settings'
  | 'manage_promos'
  | 'manage_admins'
  | 'manage_bans';

export type AdminRole = 'super_admin' | 'finance' | 'moderator' | 'content';

interface AdminCheckResponse {
  isAdmin: boolean;
  role: AdminRole | null;
  permissions: AdminPermission[];
  name: string | null;
}

export function useAdmin() {
  const { user, isLoading: authLoading } = useAuth();

  const { data, isLoading: checkLoading } = useQuery<AdminCheckResponse>({
    queryKey: ["/api/admin/check"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const isAdmin = data?.isAdmin ?? false;
  const role = data?.role ?? null;
  const permissions = data?.permissions ?? [];
  const adminName = data?.name ?? null;

  const can = (permission: AdminPermission): boolean =>
    isAdmin && permissions.includes(permission);

  return {
    isAdmin,
    role,
    permissions,
    adminName,
    can,
    isLoading: authLoading || checkLoading,
    user,
  };
}
