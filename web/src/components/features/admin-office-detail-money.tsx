"use client";
import { MoneyPanel } from "./admin-driver-money";

/** Money tab of an office: wallet, payout pipeline, settlements, ledger and withdrawals. */
export function OfficeMoneyTab({ id }: { id: string }) { return <MoneyPanel id={id} kind="office" />; }
