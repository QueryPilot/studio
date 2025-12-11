/**
 * Role Selection Dialog
 *
 * Displays a list of AWS IAM roles from SAML authentication
 * for the user to select which role to assume.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconCheck, IconShieldLock } from "@tabler/icons-react";
import type { SamlRole } from "@/services/samlAuthService";

interface RoleSelectionDialogProps {
  open: boolean;
  roles: SamlRole[];
  onSelect: (role: SamlRole) => void;
  onCancel: () => void;
}

/**
 * Extract account ID and role name from ARN
 */
function parseRoleArn(arn: string): { accountId: string; roleName: string } {
  // ARN format: arn:aws:iam::123456789012:role/RoleName
  const match = arn.match(/arn:aws:iam::(\d+):role\/(.+)/);
  if (match && match[1] && match[2]) {
    return { accountId: match[1], roleName: match[2] };
  }
  return { accountId: "unknown", roleName: arn };
}

/**
 * Extract provider name from principal ARN
 */
function parseProviderArn(arn: string): string {
  // ARN format: arn:aws:iam::123456789012:saml-provider/ProviderName
  const match = arn.match(/arn:aws:iam::\d+:saml-provider\/(.+)/);
  return match?.[1] ?? "unknown";
}

export function RoleSelectionDialog({
  open,
  roles,
  onSelect,
  onCancel,
}: RoleSelectionDialogProps) {
  const [selectedRole, setSelectedRole] = useState<SamlRole | null>(
    roles.length === 1 ? roles[0] ?? null : null,
  );

  const handleConfirm = () => {
    if (selectedRole) {
      onSelect(selectedRole);
    }
  };

  // Group roles by AWS account
  const rolesByAccount = roles.reduce((acc, role) => {
    const { accountId } = parseRoleArn(role.role_arn);
    if (!acc[accountId]) {
      acc[accountId] = [];
    }
    acc[accountId].push(role);
    return acc;
  }, {} as Record<string, SamlRole[]>);

  const accountIds = Object.keys(rolesByAccount).sort();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconShieldLock className="h-5 w-5 text-amber-500" />
            Select AWS Role
          </DialogTitle>
          <DialogDescription>
            Multiple roles are available. Select which role to assume for this
            connection.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-y-auto py-2">
          {accountIds.map((accountId) => {
            const accountRoles = rolesByAccount[accountId];
            if (!accountRoles) return null;

            return (
              <div key={accountId} className="mb-3 last:mb-0">
                <div className="text-xs font-medium text-muted-foreground mb-1.5 px-1">
                  Account: {accountId}
                </div>
                <div className="space-y-1">
                  {accountRoles.map((role) => {
                    const { roleName } = parseRoleArn(role.role_arn);
                    const providerName = parseProviderArn(role.principal_arn);
                    const isSelected = selectedRole?.role_arn === role.role_arn;

                    return (
                      <button
                        key={role.role_arn}
                        type="button"
                        onClick={() => setSelectedRole(role)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors",
                          "hover:bg-accent",
                          isSelected && "bg-accent ring-1 ring-primary",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-xs truncate">
                            {roleName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            Provider: {providerName}
                          </div>
                        </div>
                        {isSelected && (
                          <IconCheck className="h-4 w-4 text-primary flex-shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedRole}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Helper hook to use role selection as a promise
 */
export function useRoleSelection() {
  const [state, setState] = useState<{
    isOpen: boolean;
    roles: SamlRole[];
    resolve: ((role: SamlRole) => void) | null;
    reject: ((error: Error) => void) | null;
  }>({
    isOpen: false,
    roles: [],
    resolve: null,
    reject: null,
  });

  const selectRole = (roles: SamlRole[]): Promise<SamlRole> => {
    return new Promise((resolve, reject) => {
      setState({
        isOpen: true,
        roles,
        resolve,
        reject,
      });
    });
  };

  const handleSelect = (role: SamlRole) => {
    if (state.resolve) {
      state.resolve(role);
    }
    setState({ isOpen: false, roles: [], resolve: null, reject: null });
  };

  const handleCancel = () => {
    if (state.reject) {
      state.reject(new Error("Role selection cancelled"));
    }
    setState({ isOpen: false, roles: [], resolve: null, reject: null });
  };

  const DialogComponent = () => (
    <RoleSelectionDialog
      open={state.isOpen}
      roles={state.roles}
      onSelect={handleSelect}
      onCancel={handleCancel}
    />
  );

  return {
    selectRole,
    RoleSelectionDialog: DialogComponent,
  };
}
