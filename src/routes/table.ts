import {
  fetchPageById,
  fetchTableData,
  fetchNotionUsers,
  fetchBlocks,
} from "../api/notion";
import { parsePageId, getNotionValue, getRecordValue } from "../api/utils";
import {
  RowContentType,
  CollectionType,
  RowType,
  HandlerRequest,
  BlockType,
} from "../api/types";
import { createResponse } from "../response";

export const getTableData = async (
  collection: CollectionType,
  collectionViewId: string,
  notionToken?: string,
  blockData?: BlockType,
  raw?: boolean
) => {
  const collectionValue = getRecordValue<any>(collection);
  const table = await fetchTableData(
    collectionValue.id,
    collectionViewId,
    notionToken,
    blockData
  );

  const collectionRows = collectionValue.schema || {};
  const collectionColKeys = Object.keys(collectionRows);

  // Prefer reducer results if available; otherwise, fall back to scanning recordMap
  let tableArr: RowType[];
  const recordMapBlock = (table as any).recordMap && (table as any).recordMap.block ? (table as any).recordMap.block : {};
  const reducerBlockIds =
    table.result &&
    (table as any).result.reducerResults &&
    (table as any).result.reducerResults.collection_group_results &&
    Array.isArray((table as any).result.reducerResults.collection_group_results.blockIds)
      ? (table as any).result.reducerResults.collection_group_results.blockIds
      : [];

  let resolvedRecordMapBlock = recordMapBlock;
  if (Object.keys(resolvedRecordMapBlock).length === 0 && reducerBlockIds.length > 0) {
    const blocks = await fetchBlocks(reducerBlockIds, notionToken, blockData);
    resolvedRecordMapBlock =
      (blocks as any).recordMap && (blocks as any).recordMap.block
        ? (blocks as any).recordMap.block
        : {};
  }

  if (
    reducerBlockIds.length > 0
  ) {
    tableArr = reducerBlockIds
      .map((id: string) => (resolvedRecordMapBlock as any)[id])
      .filter(Boolean);
  } else {
    // Fallback: derive from recordMap
    tableArr = Object.values(resolvedRecordMapBlock as any);
  }

  if (!Array.isArray(tableArr) || tableArr.length === 0) {
    const summary = {
      hasRecordMap: Boolean((table as any).recordMap),
      blockKeys: Object.keys(resolvedRecordMapBlock || {}).slice(0, 5),
      hasReducer: Boolean((table as any).result && (table as any).result.reducerResults),
      reducerBlockIds: reducerBlockIds.slice(0, 5),
    };
    throw new Error(`No table rows found. Response summary: ${JSON.stringify(summary)}`);
  }

  const tableData = tableArr.filter(
    (b) => {
      const blockValue = getRecordValue<any>(b);
      return blockValue && blockValue.properties && blockValue.parent_id === collectionValue.id;
    }
  );

  type Row = { id: string; [key: string]: RowContentType };

  const rows: Row[] = [];

  for (const td of tableData) {
    const rowValue = getRecordValue<any>(td);
    let row: Row = { id: rowValue.id };

    for (const key of collectionColKeys) {
      const val = rowValue.properties[key];
      if (val) {
        const schema = collectionRows[key];
        row[schema.name] = raw ? val : getNotionValue(val, schema.type, td);
        if (schema.type === "person" && row[schema.name]) {
          const users = await fetchNotionUsers(row[schema.name] as string[]);
          row[schema.name] = users as any;
        }
      }
    }
    rows.push(row);
  }

  return { rows, schema: collectionRows };
};

export async function tableRoute(req: HandlerRequest) {
  const pageId = parsePageId(req.params.pageId);
  const page = await fetchPageById(pageId!, req.notionToken);

  if (!page.recordMap.collection)
    return createResponse(
      JSON.stringify({ error: "No table found on Notion page: " + pageId }),
      {},
      401
    );

  const collectionId = Object.keys(page.recordMap.collection)[0];
  const collection = page.recordMap.collection[collectionId] as CollectionType;
  const collectionValue = getRecordValue<any>(collection);
  if (!collectionValue.id) {
    collectionValue.id = collectionId;
  }

  const collectionViewId = Object.keys(page.recordMap.collection_view)[0];

  const blockData = page.recordMap.block[pageId!];

  const { rows } = await getTableData(
    collection,
    collectionViewId,
    req.notionToken,
    blockData
  );

  return createResponse(rows);
}
