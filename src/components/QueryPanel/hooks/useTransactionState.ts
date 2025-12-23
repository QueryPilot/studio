import { useTabStateStore } from "@/stores/tabStateStore";
import { toast } from "sonner";

export interface UseTransactionStateOptions {
  tabId: string;
}

interface TransactionCommandResult {
  isTransaction: boolean;
  message?: string;
}

export interface UseTransactionStateReturn {
  inTransaction: boolean;
  handleTransactionCommand: (sql: string) => TransactionCommandResult;
}

export function useTransactionState({
  tabId,
}: UseTransactionStateOptions): UseTransactionStateReturn {
  const globalState = useTabStateStore((s) => s.getQueryState(tabId));
  const setQueryState = useTabStateStore((s) => s.setQueryState);

  const inTransaction = globalState?.inTransaction || false;

  const handleTransactionCommand = (
    sql: string
  ): TransactionCommandResult => {
    const sqlUpper = sql.trim().toUpperCase();

    const isTransaction =
      sqlUpper === "BEGIN" ||
      sqlUpper === "COMMIT" ||
      sqlUpper === "ROLLBACK" ||
      sqlUpper.startsWith("ROLLBACK TO ") ||
      sqlUpper.startsWith("SAVEPOINT ") ||
      sqlUpper.startsWith("RELEASE SAVEPOINT ") ||
      sqlUpper === "START TRANSACTION";

    if (!isTransaction) {
      return { isTransaction: false };
    }

    let message: string | undefined;

    if (
      sqlUpper.startsWith("BEGIN") ||
      sqlUpper.startsWith("START TRANSACTION")
    ) {
      message = "Transaction started";
      setQueryState(tabId, { inTransaction: true });
      toast.success("Transaction started", {
        description:
          "This tab now has an active transaction. All queries in this tab will be part of this transaction until you COMMIT or ROLLBACK.",
        duration: 5000,
      });
    } else if (sqlUpper.startsWith("COMMIT")) {
      message = "Transaction committed successfully";
      setQueryState(tabId, { inTransaction: false });
    } else if (sqlUpper.startsWith("ROLLBACK")) {
      message = "Transaction rolled back successfully";
      setQueryState(tabId, { inTransaction: false });
    } else if (sqlUpper.startsWith("SAVEPOINT")) {
      message = "Savepoint created";
    } else if (sqlUpper.startsWith("RELEASE SAVEPOINT")) {
      message = "Savepoint released";
    }

    return { isTransaction: true, message };
  };

  return {
    inTransaction,
    handleTransactionCommand,
  };
}
