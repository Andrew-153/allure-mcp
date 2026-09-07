import { AllureApiClient } from "../dist/client.js";
import { TokenManager } from "../dist/auth.js";

const baseUrl = process.env.ALLURE_TESTOPS_URL ?? "https://lukasoft.testops.cloud";
const apiToken = process.env.ALLURE_TOKEN;
if (!apiToken) {
  console.error("ALLURE_TOKEN env not set");
  process.exit(2);
}
const projectId = Number(process.env.ALLURE_PROJECT_ID ?? "135");
const testCaseId = Number(process.argv[2] ?? "15054");

const tm = new TokenManager({ baseUrl, apiToken });
const client = new AllureApiClient({ baseUrl, tokenManager: tm, defaultProjectId: projectId });

const baseSelection = {
  selection: {
    projectId,
    testCasesInclude: [testCaseId],
    inverted: false,
  },
};

const baseFlat = { projectId, testCasesInclude: [testCaseId], inverted: false };

const cfvA = [{ customField: { id: -1 }, values: [{ id: 368 }] }]; // Epic «Фичи» — то, что уже стоит (no-op цель)
const cfvB = [{ customField: { id: -1 }, id: 368 }]; // flat shape
const cfvC = [{ id: 368, customField: { id: -1 } }]; // другой flat

const tries = [
  // Повторно проверим, что «replace» и «set» всё ещё 404 (sanity)
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/replace", body: { ...baseSelection, cfv: cfvA }, note: "replace (sanity)" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/set", body: { ...baseSelection, cfv: cfvA }, note: "set (sanity)" },

  // Кандидаты с тем же path-префиксом, но другим суффиксом
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/update", body: { ...baseSelection, cfv: cfvA }, note: "bulk update" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/swap", body: { ...baseSelection, cfv: cfvA }, note: "bulk swap" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/upsert", body: { ...baseSelection, cfv: cfvA }, note: "bulk upsert" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/merge", body: { ...baseSelection, cfv: cfvA }, note: "bulk merge" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/assign", body: { ...baseSelection, cfv: cfvA }, note: "bulk assign" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/patch", body: { ...baseSelection, cfv: cfvA }, note: "bulk patch" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/put", body: { ...baseSelection, cfv: cfvA }, note: "bulk put" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/change", body: { ...baseSelection, cfv: cfvA }, note: "bulk change" },

  // Без «bulk»
  { method: "POST", path: "/api/v2/test-case/cfv/replace", body: { ...baseSelection, cfv: cfvA }, note: "no-bulk replace" },
  { method: "POST", path: "/api/v2/test-case/cfv/set", body: { ...baseSelection, cfv: cfvA }, note: "no-bulk set" },

  // Per-test-case
  { method: "POST", path: `/api/v2/test-case/${testCaseId}/cfv/replace`, body: { cfv: cfvA }, note: "per-tc replace" },
  { method: "POST", path: `/api/v2/test-case/${testCaseId}/cfv/set`, body: { cfv: cfvA }, note: "per-tc set" },
  { method: "PUT", path: `/api/v2/test-case/${testCaseId}/cfv`, body: { cfv: cfvA }, note: "per-tc cfv PUT" },
  { method: "PATCH", path: `/api/v2/test-case/${testCaseId}/cfv`, body: { cfv: cfvA }, note: "per-tc cfv PATCH" },

  // Legacy v1
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv/replace`, body: { cfv: cfvA }, note: "legacy per-tc replace" },
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv/set`, body: { cfv: cfvA }, note: "legacy per-tc set" },
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv`, body: { cfv: cfvA }, note: "legacy per-tc cfv POST" },

  // Без selection, простой массив
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/replace", body: cfvA, note: "replace (plain array)" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/set", body: cfvA, note: "set (plain array)" },

  // Flat selection
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/replace", body: { ...baseFlat, cfv: cfvA }, note: "replace (flat selection)" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/set", body: { ...baseFlat, cfv: cfvA }, note: "set (flat selection)" },

  // Flat payload shape (без {customField,values}, просто {id, customField})
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/replace", body: { ...baseSelection, cfv: cfvB }, note: "replace (flat shape B)" },
  { method: "POST", path: "/api/v2/test-case/bulk/cfv/set", body: { ...baseSelection, cfv: cfvB }, note: "set (flat shape B)" },

  // Одиночный testCaseId в URL, body без selection
  { method: "POST", path: `/api/v2/test-case/${testCaseId}/cfv`, body: { cfv: cfvA }, note: "per-tc cfv POST, no sel" },

  // PATCH /api/testcase/{id} с customFields в разных формах — это мы знаем что 500. Проверим, есть ли sibling PATCH без customFields
  { method: "PATCH", path: `/api/testcase/${testCaseId}`, body: { customFields: cfvA }, note: "PATCH testcase customFields[]" },
  { method: "PATCH", path: `/api/testcase/${testCaseId}`, body: { customFields: cfvB }, note: "PATCH testcase customFields flat" },

  // PUT варианты
  { method: "PUT", path: `/api/testcase/${testCaseId}`, body: { customFields: cfvA }, note: "PUT testcase customFields" },

  // v1 /api/v1
  { method: "POST", path: `/api/v1/test-case/${testCaseId}/cfv/replace`, body: { cfv: cfvA }, note: "v1 per-tc replace" },

  // Legacy POST /api/testcase/{id}/cfv with ARRAY body (server hinted at CustomFieldValueWithCfDto[])
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv`, body: [{ customField: { id: -1 }, id: 368 }], note: "legacy POST cfv ARRAY flat id" },
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv`, body: [{ customField: { id: -1 }, name: "Фичи" }], note: "legacy POST cfv ARRAY flat name" },
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv`, body: [{ customField: { id: -1 }, id: 368, name: "Фичи" }], note: "legacy POST cfv ARRAY flat id+name" },
  { method: "POST", path: `/api/testcase/${testCaseId}/cfv`, body: [{ customField: { id: -1 }, valueId: 368 }], note: "legacy POST cfv ARRAY flat valueId" },
];

for (const t of tries) {
  try {
    const result = await client.request(t.method, t.path, t.body);
    console.log(JSON.stringify({ status: "OK", note: t.note, method: t.method, path: t.path, result }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /failed \((\d{3})\)/.exec(msg)?.[1] ?? "?";
    console.log(JSON.stringify({ status: `HTTP ${status}`, note: t.note, method: t.method, path: t.path, msg: msg.slice(0, 280) }));
  }
}
