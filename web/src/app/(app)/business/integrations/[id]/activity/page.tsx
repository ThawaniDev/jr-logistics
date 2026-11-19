"use client";
import { ActivityLog } from "../../activity";
import { useConnection } from "../../connection-detail";

export default function Page() { const { conn } = useConnection(); return <ActivityLog conn={conn} />; }
