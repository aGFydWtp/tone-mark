import json
import os
from datetime import datetime, timezone

import boto3


table_name = os.environ["SCORE_JOBS_TABLE_NAME"]
bucket_name = os.environ["SCORE_BUCKET_NAME"]
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
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
    s3.put_object(
        Bucket=bucket_name,
        Key=musicxml_key,
        Body=create_placeholder_musicxml(score_id).encode("utf-8"),
        ContentType="application/vnd.recordare.musicxml+xml; charset=utf-8",
    )

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


def create_placeholder_musicxml(score_id):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>{score_id}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <rest/>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""
