import json
import os
from datetime import datetime, timezone

import boto3


table_name = os.environ["SCORE_JOBS_TABLE_NAME"]
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(table_name)


def handler(event, context):
    processed = 0

    for record in event.get("Records", []):
        process_record(record)
        processed += 1

    print(
        json.dumps(
            {
                "message": "tone-mark worker placeholder completed",
                "record_count": processed,
                "aws_request_id": getattr(context, "aws_request_id", None),
            }
        )
    )

    return {"ok": True, "processed": processed}


def process_record(record):
    body = json.loads(record["body"])
    job_type = body.get("job_type")
    score_id = body.get("score_id")
    original_key = body.get("original_key")

    if job_type != "omr":
        raise ValueError(f"Unsupported job_type: {job_type}")
    if not score_id or not original_key:
        raise ValueError("score_id and original_key are required")

    key = {"pk": f"SCORE#{score_id}", "sk": "META"}
    now = iso_now()

    table.update_item(
        Key=key,
        UpdateExpression="SET #status = :status, original_key = :original_key, updated_at = :updated_at",
        ConditionExpression="attribute_exists(pk)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "processing_omr",
            ":original_key": original_key,
            ":updated_at": now,
        },
    )

    musicxml_key = f"scores/{score_id}/result.musicxml"
    table.update_item(
        Key=key,
        UpdateExpression=(
            "SET #status = :status, musicxml_key = :musicxml_key, "
            "updated_at = :updated_at REMOVE error_message"
        ),
        ConditionExpression="attribute_exists(pk)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "needs_review",
            ":musicxml_key": musicxml_key,
            ":updated_at": iso_now(),
        },
    )


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
