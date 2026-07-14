这是一个**可直接运行的 Python 版 mini-vLLM 模拟器**：

[mini_vllm.py](mini_vllm.py)

我已经实际跑过 100 个并发 Agent 的模拟，最终结果：

```text
ALL REQUESTS FINISHED
iterations=306
finished=100
KV used=0
KV free=20000
```

也就是说，请求全部完成后，20,000 个 KV Block 全部成功回收。

## 直接运行

```bash
python mini_vllm.py
```

默认模拟：

```text
100 个 Agent
Token Budget = 8192
max_num_seqs = 32
KV Blocks = 20000
Block Size = 16 tokens
Prefill Chunk = 2048 tokens
```

也可以自己修改参数：

```bash
python mini_vllm.py \
  --requests 100 \
  --kv-blocks 20000 \
  --block-size 16 \
  --max-num-batched-tokens 8192 \
  --max-num-seqs 32 \
  --max-prefill-chunk 2048
```

## 这个 mini-vLLM 实现了什么

核心对象关系是：

```text
MiniVLLMEngine
       │
       ├── Scheduler
       │       │
       │       ├── waiting queue
       │       ├── running requests
       │       └── finished requests
       │
       ├── BlockPool
       │       │
       │       ├── free blocks
       │       └── allocated blocks
       │
       └── FakeGPU
               │
               └── execute(dynamic batch)
```

代码里有 6 个值得重点看的类：

```python
Request
BlockPool
ScheduledItem
SchedulerOutput
Scheduler
MiniVLLMEngine
```

### 1. Request：一个 Agent 请求的状态

```python
@dataclass
class Request:
    request_id: str
    prompt_tokens: int
    max_new_tokens: int

    status: RequestStatus = RequestStatus.WAITING
    computed_prompt_tokens: int = 0
    generated_tokens: int = 0

    block_table: List[int] = field(default_factory=list)
```

比如：

```text
agent-001

prompt_tokens = 5000
computed_prompt_tokens = 2048
generated_tokens = 0
```

说明：

```text
Prompt 总长度：5000
已经 Prefill：2048
剩余 Prompt：2952
```

它当前的 phase：

```python
@property
def phase(self) -> str:
    if self.is_finished:
        return "finished"

    if not self.is_prefill_done:
        return "prefill"

    return "decode"
```

所以 Request 本质是：

```text
一个状态机

WAITING
   ↓
PREFILL
   ↓
DECODE
   ↓
FINISHED
```

---

## 2. BlockPool：模拟 Paged KV Cache

这是整个代码最关键的部分之一：

```python
self._free_blocks = deque(range(num_blocks))
```

假设：

```text
num_blocks = 10
```

开始：

```text
Free Block Pool

[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
```

Request A 需要保存 40 tokens。

```text
block_size = 16
```

需要：

```python
ceil(40 / 16)
= 3 blocks
```

代码：

```python
required_blocks = math.ceil(
    target_total_tokens / self.block_size
)
```

然后：

```python
block_id = self._free_blocks.popleft()

self._allocated_owner[block_id] = request.request_id

request.block_table.append(block_id)
```

结果：

```text
Request A

block_table = [0, 1, 2]
```

此时：

```text
Free Blocks

[3, 4, 5, 6, 7, 8, 9]
```

请求结束：

```python
self.block_pool.release(request)
```

Block 回收：

```text
[0, 1, 2]

↓ release

Free Block Pool
```

这就是极简版：

```text
Paged KV Cache Manager
```

---

## 3. Scheduler：mini-vLLM 的大脑

最核心的方法：

```python
def schedule(self) -> SchedulerOutput:
```

逻辑分两步。

第一步：

```python
for request in list(self.running):
```

优先处理 RUNNING Request。

例如：

```text
Agent 1 → Decode
Agent 2 → Decode
Agent 3 → Prefill
```

Scheduler 计算：

```python
_tokens_for_request()
```

Decode：

```python
if request.phase == "decode":
    return 1
```

也就是：

```text
Agent 1 → 1 token
Agent 2 → 1 token
```

Prefill：

```python
return min(
    request.remaining_prompt_tokens,
    self.max_prefill_chunk,
    remaining_budget,
)
```

例如：

```text
Agent 3

remaining prompt = 5000
max_prefill_chunk = 2048
budget = 8190
```

Scheduler：

```text
schedule 2048 tokens
```

所以形成：

```text
Agent 1   decode       1
Agent 2   decode       1
Agent 3   prefill   2048
```

---

## 4. Continuous Batching 在哪里？

就在这里：

```python
waiting_attempts = len(self.waiting)

for _ in range(waiting_attempts):
```

RUNNING 请求调度完以后：

```text
Token Budget = 8192

Running 消耗：

Agent 1 = 1
Agent 2 = 1
Agent 3 = 2048
```

剩余：

```text
6142 tokens
```

Scheduler 不会让 GPU 直接运行。

它继续：

```text
Waiting Queue
```

拿新的 Agent：

```python
request = self.waiting[0]
```

加入当前 Batch：

```python
self.waiting.popleft()

request.status = RequestStatus.RUNNING

self.running.append(request)

items.append(item)
```

因此：

```text
Iteration N

Agent 1 decode
Agent 2 decode
Agent 3 prefill
Agent 4 prefill
Agent 5 prefill
```

下一轮：

```text
Iteration N+1

Agent 1 decode
Agent 2 decode
Agent 3 prefill
Agent 4 decode
Agent 5 prefill
Agent 6 prefill
```

注意：

> Batch 已经发生变化。

这就是代码级别的 Continuous Batching。

---

## 5. GPU 在这个模拟器中的位置

```python
class FakeGPU:

    def execute(
        self,
        output: SchedulerOutput
    ) -> None:

        if not output.items:
            return

        return
```

这里故意什么都没干。

因为当前模拟的是：

```text
Scheduler
KV Cache
Request State
Continuous Batching
```

而不是真的：

```text
Transformer Forward
```

真实 vLLM 这里大致对应：

```text
SchedulerOutput
      ↓
GPU Model Runner
      ↓
prepare input_ids
prepare positions
prepare block tables
prepare slot mappings
      ↓
Transformer Forward
      ↓
Paged Attention
      ↓
LM Head
      ↓
Sampling
```

我们的 FakeGPU：

```python
self.gpu.execute(output)
```

可以理解为：

```text
假装 GPU 已经完成一次 Forward
```

然后：

```python
self.scheduler.update_after_execution(output)
```

更新状态。

Prefill：

```python
request.computed_prompt_tokens += item.num_tokens
```

Decode：

```python
request.generated_tokens += item.num_tokens
```

---

## 6. 实际输出怎么看

你运行后会看到类似：

```text
ITERATION 1
----------------------------------------------------------------------------------------
batch_requests= 4
scheduled_tokens= 8192/8192
prefill=8192
decode=0

waiting=96
running=4
finished=0

KV blocks used=512
free=19488
```

含义：

```text
第 1 轮 Scheduler

100 个 Request
↓
4 个进入 RUNNING
↓
共调度 8192 tokens
↓
全是 Prefill
↓
使用 512 KV Blocks
```

为什么正好 512？

```text
8192 / 16
= 512 blocks
```

下一轮可能看到：

```text
prefill=8188
decode=4
```

意思是：

```text
4 个已有 Request
↓
每个 Decode 1 token
↓
4 tokens

剩余 Budget
↓
8188 tokens

加入新 Request 做 Prefill
```

这其实非常形象地展示了：

```text
Decode
+
Prefill
+
Continuous Batching
```

---

## 我建议你读代码的顺序

不要从 `main()` 顺着看。

直接按这个顺序：

```text
第一遍
Request.phase

↓

第二遍
BlockPool.allocate()
BlockPool.release()

↓

第三遍
Scheduler._tokens_for_request()

↓

第四遍
Scheduler._try_schedule_request()

↓

第五遍
Scheduler.schedule()

↓

第六遍
Scheduler.update_after_execution()

↓

最后
MiniVLLMEngine.run()
```

尤其重点看：

```python
Scheduler.schedule()
```

**整个 mini-vLLM 最核心的代码基本就在这个方法里。**

下一步最有价值的是继续把这个模拟器升级成 **mini-vLLM V2**：不用 `FakeGPU`，而是接入 PyTorch，实现一个真正的小 Transformer，并让 `BlockPool.block_table` 真正控制 KV Cache Tensor 的读写。这样就能亲手实现一个简化版 **PagedAttention**。
