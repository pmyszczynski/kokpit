"use client";

import { createContext, useContext } from "react";
import { defaultPollingLifecycle, type PollingLifecycle } from "@/lib/clientPolling";

/** IMP-11's access/configuration owner supplies the protected surface's gate. */
const PollingLifecycleContext = createContext<PollingLifecycle>(defaultPollingLifecycle);
export const PollingLifecycleProvider = PollingLifecycleContext.Provider;
export const usePollingLifecycle = () => useContext(PollingLifecycleContext);
