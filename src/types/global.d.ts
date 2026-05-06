import type { TakeoutApi } from "./electronApi";

declare global {
  interface Window {
    takeoutApi: TakeoutApi;
  }
}

export {};
