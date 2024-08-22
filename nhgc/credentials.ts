/*
 * Copyright 2024 Synadia Communications, Inc
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export function getConnectionDetails(): { url: string; apiKey: string } {
  const url = Deno.env.get("NHG_URL") ?? "http://localhost";
  const apiKey = Deno.env.get("NHG_APIKEY") ?? "XxX";
  return { url, apiKey };
}

export function randomKvName(): string {
  return `TESTKV_${crypto.randomUUID()}`;
}
