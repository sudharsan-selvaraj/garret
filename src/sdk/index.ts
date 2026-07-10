// The app's SDK binding: instantiate the realm-agnostic widget SDK for the NATIVE
// host realm (the app's React + the ipc client) and re-export it under the stable
// `@sdk` alias so every built-in widget keeps importing from one place. The hook
// logic + types live in the published packages (garret-core / garret-widget-sdk);
// only this realm binding lives in the app.
import * as React from 'react'
import { createSDK } from 'garret-widget-sdk'
import { ipcClient } from './ipcClient'

/** The native-realm SDK instance. Exported so the framework can inject it into each
 *  widget's render/settings props (WidgetRenderProps.sdk) — the same shape the sandbox
 *  runtime will inject from a bridge-backed sdk. */
export const sdk = createSDK(React, ipcClient)

export const usePolledQuery = sdk.usePolledQuery
export const useServiceStatus = sdk.useServiceStatus
export const useFileWatch = sdk.useFileWatch
export const services = sdk.services
export const openExternal = sdk.openExternal

export { WidgetStatus } from 'garret-widget-sdk'

// Pure surface (types, field builders, defaults, validators, defineWidget,
// canonicalKey, GarretClient, …) comes straight from core.
export * from 'garret-core'
