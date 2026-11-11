import "server-only";
import type { DocumentReference, DocumentStore, Transaction } from "./document-store";
import { member, rateLimit, hash, type ServiceActor } from "./service-context";
import { ApiError, object, text, integer, uuid } from "./validation";
import { entityRelationValues, type EntityRelationScope, type EntityRelationValues } from "../entity-database-relations";
function requireProjects(db:DocumentStore) { if(!db.capabilities?.projects)throw new ApiError(400,"feature_unavailable","Relations require the PostgreSQL deployment."); }

export async function readEntityRelationFields(db:DocumentStore, workspace:DocumentReference, actor:ServiceActor) {
  requireProjects(db);
  return db.runTransaction(async tx=>{
    await member(tx,workspace,actor.uid);
    const rows=await tx.get(workspace.collection("entityRelationFields").limit(65));
    return {fields:rows.docs.map(row=>({id:row.id,...row.data()}))};
  });
}

export async function saveEntityRelationField(db:DocumentStore, workspace:DocumentReference, actor:ServiceActor, id:string, input:unknown) {
  requireProjects(db); const fieldId=uuid(id); await rateLimit(db,actor.uid,"entity_relation_field",30);
  const data=object(input,["name","scope","targetDatabaseId","expectedRevision","operationId"]);
  const name=text(data.name,"Property name",80), targetDatabaseId=uuid(data.targetDatabaseId), operationId=uuid(data.operationId);
  const scope=data.scope;
  if(scope!=="task"&&scope!=="project") throw new ApiError(400,"invalid_input","Choose task or project properties.");
  const expected=integer(data.expectedRevision,"Expected revision",0,1000000000);
  const digest=hash(JSON.stringify([fieldId,name,scope,targetDatabaseId,expected]));
  return db.runTransaction(async tx=>{
    await member(tx,workspace,actor.uid);
    const ref=workspace.collection("entityRelationFields").doc(fieldId), receipt=workspace.collection("entityRelationOperations").doc(hash(`${actor.uid}:${operationId}`));
    const [old,accepted,definitions,target]=await Promise.all([tx.get(ref),tx.get(receipt),tx.get(workspace.collection("entityRelationFields").limit(65)),tx.get(workspace.collection("databases").doc(targetDatabaseId))]);
    if(accepted.exists){if(accepted.data()?.digest!==digest)throw new ApiError(409,"operation_conflict","This save identity was used for different changes.");if(!old.exists)throw new ApiError(404,"not_found","Property no longer exists.");return {id:fieldId,...old.data()};}
    if((old.data()?.revision??0)!==expected)throw new ApiError(409,"revision_conflict","This property changed. Reopen it before saving.");
    if(old.exists&&(old.data()?.scope!==scope||old.data()?.targetDatabaseId!==targetDatabaseId))throw new ApiError(400,"invalid_input","A relation's scope and data source cannot change.");
    if(!target.exists||(!old.exists&&target.data()?.archived))throw new ApiError(400,"invalid_target","Choose an active database in this workspace.");
    if(!old.exists&&definitions.docs.filter(row=>row.data().scope===scope).length>=32)throw new ApiError(409,"property_limit","This property set supports 32 relations.");
    if(definitions.docs.some(row=>row.id!==fieldId&&row.data().scope===scope&&String(row.data().name).toLowerCase()===name.toLowerCase()))throw new ApiError(409,"name_conflict","A relation with this name already exists.");
    const next={name,scope,targetDatabaseId,revision:expected+1};
    tx.set(ref,next); tx.create(receipt,{uid:actor.uid,digest});
    return {id:fieldId,...next};
  });
}

/** Call before transaction writes; validate against current same-workspace records. */
export async function validateEntityRelationValues(tx:Transaction, workspace:DocumentReference, scope:EntityRelationScope, input:unknown, previous:EntityRelationValues = {}) {
  let values:EntityRelationValues;
  try { values=entityRelationValues(input); } catch(error) { throw new ApiError(400,"invalid_input",(error as Error).message); }
  for(const [fieldId,ids] of Object.entries(values)) {
    const field=await tx.get(workspace.collection("entityRelationFields").doc(fieldId));
    if(!field.exists||field.data()?.scope!==scope)throw new ApiError(400,"invalid_relation","This relation property is unavailable.");
    const databaseId=field.data()!.targetDatabaseId;
    const database=await tx.get(workspace.collection("databases").doc(databaseId));
    if(!database.exists)throw new ApiError(400,"invalid_relation","This relation's data source is unavailable.");
    for(const id of ids){
      const entry=await tx.get(workspace.collection("databaseEntries").doc(id));
      const retained=previous[fieldId]?.includes(id);
      if(!entry.exists||entry.data()?.databaseId!==databaseId||(!retained&&(entry.data()?.archived||database.data()?.archived)))throw new ApiError(400,"invalid_relation","Choose active entries from this relation's data source.");
    }
  }
  return values;
}
