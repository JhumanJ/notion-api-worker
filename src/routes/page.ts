import { fetchPageById, fetchBlocks } from "../api/notion";
import { parsePageId, getRecordValue } from "../api/utils";
import { createResponse } from "../response";
import { getTableData } from "./table";
import { BlockType, CollectionType, HandlerRequest } from "../api/types";

export async function pageRoute(req: HandlerRequest) {
  const pageId = parsePageId(req.params.pageId);
  const page = await fetchPageById(pageId!, req.notionToken);

  const baseBlocks = page.recordMap.block;
  const rootBlock = baseBlocks[pageId!];

  let allBlocks: { [id: string]: BlockType & { collection?: any } } = {
    ...baseBlocks,
  };
  let allBlockKeys;

  while (true) {
    allBlockKeys = Object.keys(allBlocks);

    const pendingBlocks = allBlockKeys.flatMap((blockId) => {
      const block = allBlocks[blockId];
      const blockValue = getRecordValue<any>(block);
      const content = blockValue && blockValue.content;

      if (!content || (blockValue.type === "page" && blockId !== pageId!)) {
        // skips pages other than the requested page
        return [];
      }

      return content.filter((id: string) => !allBlocks[id]);
    });

    if (!pendingBlocks.length) {
      break;
    }

    const newBlocks = await fetchBlocks(pendingBlocks, req.notionToken, rootBlock).then(
      (res) => res.recordMap.block
    );

    allBlocks = { ...allBlocks, ...newBlocks };
  }

  const collection = page.recordMap.collection
    ? page.recordMap.collection[Object.keys(page.recordMap.collection)[0]]
    : null;

  const collectionView = page.recordMap.collection_view
    ? page.recordMap.collection_view[
        Object.keys(page.recordMap.collection_view)[0]
      ]
    : null;

  if (collection && collectionView) {
    const pendingCollections = allBlockKeys.flatMap((blockId) => {
      const block = allBlocks[blockId];
      const blockValue = getRecordValue<any>(block);

      return blockValue && blockValue.type === "collection_view" ? [blockValue.id] : [];
    });

    for (let b of pendingCollections) {
      const collPage = await fetchPageById(b!, req.notionToken);

      const collId = Object.keys(collPage.recordMap.collection)[0];
      const coll = collPage.recordMap.collection[collId] as CollectionType;
      const collValue = getRecordValue<any>(coll);
      if (!collValue.id) {
        collValue.id = collId;
      }

      const collViewId = Object.keys(collPage.recordMap.collection_view)[0];

      const { rows, schema } = await getTableData(
        coll,
        collViewId,
        req.notionToken,
        rootBlock,
        true
      );

      const viewIds = getRecordValue<any>(allBlocks[b]).view_ids as string[];

      allBlocks[b] = {
        ...allBlocks[b],
        collection: {
          title: collValue.name,
          schema,
          types: viewIds.map((id) => {
            const col = collPage.recordMap.collection_view[id];
            return col ? getRecordValue(col) : undefined;
          }),
          data: rows,
        },
      };
    }
  }

  return createResponse(allBlocks);
}
