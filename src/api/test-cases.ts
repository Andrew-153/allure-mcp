import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

type JsonRecord = Record<string, unknown>;
type CustomFieldValueRef = { id?: number; name?: string };
type CustomFieldBulkAddValue = CustomFieldValueRef & { customField: { id: number } };
type TestTagRef = { id?: number; name?: string };
type ExternalLinkRef = { url: string; name?: string; type?: string };

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function toCustomFieldValueRef(
  value: unknown,
  index: number,
  source: "values" | "flat",
): CustomFieldValueRef {
  const row = asRecord(value);
  if (!row) {
    throw new Error(`"payload[${index}]" must be an object.`);
  }

  const id = typeof row.id === "number" ? row.id : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  if (id === undefined && name === undefined) {
    if (source === "values") {
      throw new Error(
        `"payload[${index}].values[]" items must include at least one of "id" or "name".`,
      );
    }
    throw new Error(`"payload[${index}]" must include at least one of "id" or "name".`);
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

export function normalizeCustomFieldBulkAddPayload(payload: unknown): CustomFieldBulkAddValue[] {
  if (!Array.isArray(payload)) {
    throw new Error("\"payload\" must be an array.");
  }

  const flattened: CustomFieldBulkAddValue[] = [];

  payload.forEach((entry, index) => {
    const row = asRecord(entry);
    if (!row) {
      throw new Error(`"payload[${index}]" must be an object.`);
    }

    const customField = asRecord(row.customField);
    const customFieldId = customField && typeof customField.id === "number"
      ? customField.id
      : undefined;
    if (customFieldId === undefined) {
      throw new Error(`"payload[${index}].customField.id" must be a number.`);
    }

    if ("values" in row) {
      if (!Array.isArray(row.values)) {
        throw new Error(`"payload[${index}].values" must be an array.`);
      }
      const values = row.values.map((value) => ({
        customField: { id: customFieldId },
        ...toCustomFieldValueRef(value, index, "values"),
      }));
      flattened.push(...values);
      return;
    }

    // Backward-compatible input shape support:
    // [{ id, name, customField: { id } }] -> bulk add cfv payload
    const flatValue = toCustomFieldValueRef(row, index, "flat");
    flattened.push({
      customField: { id: customFieldId },
      ...flatValue,
    });
  });

  if (flattened.length === 0) {
    throw new Error("\"payload\" must contain at least one custom field value.");
  }

  return flattened;
}

export function listTestCases(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testcase", {
    projectId,
    ...query,
  });
}

interface TreeNode {
  id: number;
  type: "GROUP" | "LEAF";
  name: string;
  parentNodeId?: number;
  testCaseId?: number;
  count?: number;
  customFieldId?: number;
  customFieldValueId?: number;
  status?: { id: number; name: string };
  automated?: boolean;
}

export interface ListTreeNodesResponse {
  id?: number;
  name?: string;
  children?: {
    content: TreeNode[];
    empty: boolean;
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
  };
}

export function buildContentSearchFilter(value: string): string {
  const filter = [{ id: "content", value, type: "string" }];
  return Buffer.from(JSON.stringify(filter), "utf8").toString("base64");
}

export async function listTreeNodes(
  client: AllureApiClient,
  projectId: number,
  options: {
    treeId: number;
    parentNodeId?: number;
    search?: string;
    page?: number;
    size?: number;
    deleted?: boolean;
  },
): Promise<ListTreeNodesResponse> {
  const params: QueryParams = {
    treeId: options.treeId,
    page: options.page ?? 0,
    size: options.size ?? 100,
    deleted: options.deleted ?? false,
    sort: ["nodeSortOrder,asc", "name,asc"],
  };
  if (options.parentNodeId !== undefined) {
    params.parentNodeId = options.parentNodeId;
  }
  if (options.search && options.search.length > 0) {
    params.search = buildContentSearchFilter(options.search);
  }
  return client.get(
    `/api/v2/project/${projectId}/test-case/tree/tree-node`,
    params,
  ) as Promise<ListTreeNodesResponse>;
}

export async function countTreeLeaves(
  client: AllureApiClient,
  projectId: number,
  options: {
    treeId: number;
    search?: string;
    deleted?: boolean;
  },
): Promise<{ filtered: number; total: number }> {
  const params: QueryParams = {
    treeId: options.treeId,
    deleted: options.deleted ?? false,
    sort: "name,asc",
  };
  if (options.search && options.search.length > 0) {
    params.search = buildContentSearchFilter(options.search);
  }
  return client.get(
    `/api/testcasetree/countleaves`,
    { projectId, ...params },
  ) as Promise<{ filtered: number; total: number }>;
}

export function searchTestCases(
  client: AllureApiClient,
  projectId: number,
  rql: string,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testcase/__search", {
    projectId,
    rql,
    ...query,
  });
}

export function getTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/testcase/${id}`);
}

export function createTestCase(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testcase", payload);
}

export function updateTestCase(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/testcase/${id}`, payload);
}

export function deleteTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/testcase/${id}`);
}

export function getTestCaseOverview(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/overview`);
}

export function getTestCaseHistory(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/testcase/${id}/history`, query);
}

// Allure TestOps keeps TWO independent scenario storages per test case:
// - legacy (GET/POST /api/testcase/{id}/scenario): flat step list, what every
//   freshly-created test case uses by default.
// - rich tree (GET /api/testcase/{id}/step, write via
//   POST/PATCH/DELETE /api/testcase/step[/{id}]): a node graph used once a
//   test case has been migrated (POST /api/testcase/{id}/migrate — irreversible).
// The legacy endpoint silently returns {"steps": []} for any already-migrated
// test case instead of erroring, so callers must read the rich tree to get
// real content for migrated cases. Verified against project 135, 2026-09-04:
// legacy /scenario on a migrated case returns {"steps":[]} while /step returns
// the real content below.
export interface ScenarioNode {
  step: string;
  expectedResult?: string;
  steps?: ScenarioNode[];
}

interface RawStepNode {
  id: number;
  body: string;
  bodyJson?: unknown;
  children?: number[];
  expectedResultId?: number;
}

interface RawStepTree {
  root?: { children?: number[] };
  scenarioSteps?: Record<string, RawStepNode>;
}

// The real expected-result text is not stored directly on expectedResultId —
// that id points to a placeholder node (body literally "Expected Result")
// whose own first child holds the actual text. Example live shape:
//   step node:   { id: 8079, body: "...", expectedResultId: 8080 }
//   ER wrapper:  { id: 8080, body: "Expected Result", children: [8081] }
//   ER content:  { id: 8081, body: "Товар появился ..." }
function buildScenarioNode(
  nodes: Record<string, RawStepNode>,
  id: number,
): ScenarioNode | undefined {
  const node = nodes[String(id)];
  if (!node) {
    return undefined;
  }

  let expectedResult: string | undefined;
  if (node.expectedResultId !== undefined) {
    const erWrapper = nodes[String(node.expectedResultId)];
    const erContentId = erWrapper?.children?.[0];
    const erContent = erContentId !== undefined ? nodes[String(erContentId)] : erWrapper;
    expectedResult = erContent?.body;
  }

  const subSteps = node.children
    ?.map((childId) => buildScenarioNode(nodes, childId))
    .filter((child): child is ScenarioNode => child !== undefined);

  return {
    step: node.body,
    ...(expectedResult !== undefined ? { expectedResult } : {}),
    ...(subSteps && subSteps.length > 0 ? { steps: subSteps } : {}),
  };
}

export async function getTestCaseRichSteps(
  client: AllureApiClient,
  id: number,
): Promise<RawStepTree> {
  return client.get(`/api/testcase/${id}/step`);
}

export async function getTestCaseScenario(
  client: AllureApiClient,
  id: number,
): Promise<{ steps: ScenarioNode[] }> {
  const tree = await getTestCaseRichSteps(client, id);
  const nodes = tree.scenarioSteps ?? {};
  const rootIds = tree.root?.children ?? [];
  const steps = rootIds
    .map((rootId) => buildScenarioNode(nodes, rootId))
    .filter((node): node is ScenarioNode => node !== undefined);
  return { steps };
}

export function getTestCaseScenarioLegacy(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/testcase/${id}/scenario`);
}

interface LegacyScenarioStep {
  name: string;
  expectedResult?: string;
  steps?: LegacyScenarioStep[];
}

function toLegacyStep(node: ScenarioNode): LegacyScenarioStep {
  return {
    name: node.step,
    ...(node.expectedResult !== undefined ? { expectedResult: node.expectedResult } : {}),
    ...(node.steps && node.steps.length > 0 ? { steps: node.steps.map(toLegacyStep) } : {}),
  };
}

export function setTestCaseScenarioLegacy(
  client: AllureApiClient,
  id: number,
  steps: ScenarioNode[],
): Promise<unknown> {
  return client.post(`/api/testcase/${id}/scenario`, { steps: steps.map(toLegacyStep) });
}

export interface AddStepPayload {
  testCaseId: number;
  step: string;
  expectedResult?: string;
  afterId?: number;
  parentId?: number;
  withExpectedResult?: boolean;
}

// Write endpoints below are reconstructed from documented behavior, not
// re-verified live (writing to a real project's scenario data was avoided
// during recovery) — smoke-test against a scratch test case before relying
// on them, per the standalone `node dist/index.js < requests.jsonl` pattern.
export function addTestCaseStep(
  client: AllureApiClient,
  payload: AddStepPayload,
): Promise<unknown> {
  const { testCaseId, step, expectedResult, afterId, parentId, withExpectedResult } = payload;
  return client.post("/api/testcase/step", {
    testCaseId,
    body: step,
    ...(expectedResult !== undefined ? { expectedResult } : {}),
    ...(afterId !== undefined ? { afterId } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(withExpectedResult !== undefined ? { withExpectedResult } : {}),
  });
}

export function updateTestCaseStep(
  client: AllureApiClient,
  stepId: number,
  payload: { step?: string; expectedResult?: string },
): Promise<unknown> {
  return client.patch(`/api/testcase/step/${stepId}`, {
    ...(payload.step !== undefined ? { body: payload.step } : {}),
    ...(payload.expectedResult !== undefined ? { expectedResult: payload.expectedResult } : {}),
  });
}

export function deleteTestCaseStep(client: AllureApiClient, stepId: number): Promise<unknown> {
  return client.delete(`/api/testcase/step/${stepId}`);
}

// Irreversible: promotes the legacy scenario (if any) into the rich tree.
// There is no way back to legacy afterward. Correct order confirmed by
// direct reproduction: set the legacy scenario FIRST (so there's real
// content to carry over), THEN migrate — migrating an empty scenario does
// not reliably end up rich afterward.
export function migrateTestCaseScenario(client: AllureApiClient, id: number): Promise<unknown> {
  return client.post(`/api/testcase/${id}/migrate`);
}

export async function setTestCaseScenario(
  client: AllureApiClient,
  id: number,
  steps: ScenarioNode[],
): Promise<{ mode: "legacy" | "rich"; result: unknown }> {
  const tree = await getTestCaseRichSteps(client, id);
  const hasRichContent = (tree.root?.children?.length ?? 0) > 0;

  if (!hasRichContent) {
    const result = await setTestCaseScenarioLegacy(client, id, steps);
    return { mode: "legacy", result };
  }

  const created: unknown[] = [];
  let afterId: number | undefined;
  for (const node of steps) {
    if (node.steps && node.steps.length > 0) {
      throw new Error(
        "Nested sub-steps are not supported when writing to an already-migrated " +
          "(rich-tree) test case — only flat, top-level steps. Use legacy mode " +
          "(a not-yet-migrated test case) for nested steps.",
      );
    }
    const stepResult = await addTestCaseStep(client, {
      testCaseId: id,
      step: node.step,
      expectedResult: node.expectedResult,
      afterId,
    });
    const createdId = asRecord(stepResult)?.id;
    afterId = typeof createdId === "number" ? createdId : afterId;
    created.push(stepResult);
  }
  return { mode: "rich", result: created };
}

export function getTestCaseTags(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/tag`);
}

export function setTestCaseTags(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/tag`, payload);
}

export function getTestCaseIssues(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/issue`);
}

export function setTestCaseIssues(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/issue`, payload);
}

export function restoreTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.post(`/api/testcase/${id}/restore`);
}

export function listProjectCustomFields(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/project/${projectId}/cf`, query);
}

export function listCustomFieldValues(
  client: AllureApiClient,
  projectId: number,
  customFieldId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/project/${projectId}/cfv`, {
    customFieldId,
    ...query,
  });
}

export function getTestCaseCustomFields(
  client: AllureApiClient,
  testCaseId: number,
  projectId: number,
): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/cfv`, {
    projectId,
  });
}

export function setTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/add", {
    selection: {
      projectId,
      testCasesInclude: [testCaseId],
      inverted: false,
    },
    cfv,
  });
}

export function addTagsToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tags: TestTagRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    tags,
  });
}

export function removeTagsFromTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tagIds: number[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/remove", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    ids: tagIds,
  });
}

export function addExternalLinksToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  links: ExternalLinkRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/external-link/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    links,
  });
}

export function removeCustomFieldsFromTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  customFieldIds: number[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/cfv/remove", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    ids: customFieldIds,
  });
}

export function bulkSetTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    cfv,
  });
}

// Atomic replace of custom-field values for one or more test cases. Unlike
// add/remove, this single call drops the previous values of the listed
// custom fields and substitutes them with the new ones — required when the
// custom field is singleSelect and `add` would otherwise leave the old
// value dangling. See /api/v2/test-case/bulk/cfv/replace.
export function replaceTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/replace", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    cfv,
  });
}

// Convenience wrapper for the most common case: set one custom field on
// one test case to a single value. Equivalent to replace with a one-element
// payload, but easier to call from agents that only need to flip a single
// enum-like field (Тайминг, Приоритеты, etc.).
export async function replaceSingleTestCaseCustomFieldValue(
  client: AllureApiClient,
  projectId: number,
  testCaseId: number,
  customFieldId: number,
  valueId: number,
): Promise<unknown> {
  return replaceTestCaseCustomFields(client, projectId, [testCaseId], [
    { customField: { id: customFieldId }, values: [{ id: valueId }] },
  ]);
}

export function deleteCustomFieldValue(
  client: AllureApiClient,
  valueId: number,
): Promise<unknown> {
  return client.delete(`/api/cfv/${valueId}`);
}

export function renameCustomFieldValue(
  client: AllureApiClient,
  valueId: number,
  newName: string,
): Promise<unknown> {
  return client.patch(`/api/cfv/${valueId}`, { name: newName });
}
