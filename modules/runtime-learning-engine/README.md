# Runtime Learning Engine para Android 10

Um módulo inteligente de **aprendizado e auto-correção** para Frida que captura bugs em runtime, aprende padrões e aplica correções automáticas com garantias de rollback.

## Características

✅ **Captura de Bugs em Tempo Real**
- Crashes (NullPointerException, etc)
- ANR (Application Not Responding)
- Memory leaks e pressure
- Deadlocks

✅ **Aprendizado Contínuo**
- Análise de frequência de bugs
- Detecção de padrões com confiança >= 75%
- Armazenamento em circular JSON bank (512 eventos)

✅ **Auto-Correção com 3 Estratégias**
- Try-catch with fallback
- Monkey-patch from journal
- Component restart

✅ **Segurança e Rollback**
- Rollback journal antes de qualquer patch
- Watchdog com heartbeat (1000ms)
- Epoch timeout (5000ms) com failsafe automático
- Rollback verification com checksums FNV-1a 64

✅ **Testes Contínuos**
- Smoke tests (função funciona?)
- Regression tests (não quebrou outra coisa?)
- Performance tests (não degradou?)
- Rollback automático se testes falharem

## Arquitetura

```
RuntimeLearningEngine (orquestrador)
├── BugCapture (hooks Frida)
├── BugStore (JSON circular)
├── PatternDetector (análise)
├── AutoFixer (3 estratégias)
├── RollbackEngine (journal + verify)
├── WatchdogMonitor (heartbeat + epoch)
└── TestSuite (smoke + regression + perf)
```

## Uso Básico

### 1. Inicializar o Engine

```typescript
import { initializeEngine } from './modules/runtime-learning-engine';

const engine = await initializeEngine({
  storage_path: '/data/local/tmp/frida-learning',
  bug_capacity: 512,
  confidence_threshold: 0.75,
  min_occurrences_before_fix: 3,
  heartbeat_interval_ms: 1000,
  epoch_timeout_ms: 5000
});

console.log('Engine running:', engine.isRunning());
```

### 2. Capturar Bugs Manualmente

```typescript
engine.captureBug({
  bug_type: 'crash',
  class: 'com.example.App',
  method: 'onCreate',
  exception_type: 'NullPointerException',
  severity: 'critical'
});
```

### 3. Monitorar Status

```typescript
const stats = engine.getStats();
console.log('Stats:', {
  running: stats.running,
  recentBugsCount: stats.recentBugsCount,
  pendingRollbacks: stats.pendingRollbacks,
  watchdog: stats.watchdogStats
});
```

### 4. Shutdown

```typescript
await engine.shutdown();
```

## Fluxo de Execução

```
1. Engine.start()
   ├─ BugCapture.startCapture() → ativa hooks
   ├─ WatchdogMonitor.startWatchdog() → heartbeat
   └─ Carrega histórico e detecta padrões

2. Bug Capturado
   ├─ BugStore.appendEvent() → salva em bug-history.json
   ├─ PatternDetector.detectPatterns() → analisa
   └─ Se padrão encontrado:
       ├─ AutoFixer.applyFix() → tenta corrigir
       ├─ TestSuite.runAfterFix() → valida
       ├─ Se testes passam: commitFix()
       └─ Se testes falham: rollback() + FAILSAFE

3. WatchdogMonitor.heartbeat() a cada 1000ms
   └─ Se timeout (5000ms): triggerRollback() + FAILSAFE
```

## Arquivos de Saída

### `/data/local/tmp/frida-learning/bug-history.json`
```json
{
  "schema": 1,
  "events": [
    {
      "id": "evt_...",
      "timestamp": 1693456789,
      "bug_type": "crash",
      "class": "com.example.App",
      "method": "onCreate",
      "exception_type": "NullPointerException",
      "stack_hash": "hash_abc123",
      "severity": "critical",
      "status": "new"
    }
  ],
  "patterns": [
    {
      "pattern_id": "pat_...",
      "bug_type": "crash",
      "class": "com.example.App",
      "method": "onCreate",
      "exception_type": "NullPointerException",
      "occurrences": 5,
      "confidence": 0.92,
      "last_seen": 1693456789,
      "suggested_fix": "null_check_on_line_42",
      "fix_strategy": "try_catch_with_fallback"
    }
  ],
  "fix_events": [...],
  "watchdog_events": [...],
  "integrity_hash": "fnv1a64_hash",
  "last_updated": 1693456789
}
```

### `/data/local/tmp/frida-learning/rollback-journal.json`
```json
{
  "journals": [
    {
      "journal_id": "journal_...",
      "timestamp": 1693456789,
      "fix_id": "fix_...",
      "original_bytes": [...],
      "target_address": 12345678,
      "size": 512,
      "checksum_before": "0xabc123...",
      "checksum_after": "0xdef456...",
      "verification_passed": true
    }
  ]
}
```

### `/data/local/tmp/frida-learning/watchdog-events.json`
```json
{
  "events": [
    {
      "timestamp": 1693456789,
      "heartbeat_count": 10,
      "epoch": 1,
      "state": "STABLE",
      "trap_count": 0
    },
    {
      "timestamp": 1693456794,
      "heartbeat_count": 0,
      "epoch": 2,
      "state": "FAILSAFE",
      "trap_count": 1,
      "rollback_triggered": true,
      "reason": "epoch_timeout"
    }
  ]
}
```

## Estados do Watchdog

- **STABLE**: Tudo operacional, nenhum problema detectado
- **OBSERVE**: Fix aplicado, monitorando comportamento
- **DUMP**: Coletando diagnóstico detalhado
- **FAILSAFE**: Modo seguro ativado, instrumentation desabilitada

## Estratégias de Correção

### 1. Try-Catch with Fallback
Intercepta chamadas bugadas e envolve em try-catch com fallback seguro.
- Melhor para: Crashes ocasionais
- Overhead: Baixo
- Reversibilidade: Imediata (apenas hook)

### 2. Monkey-Patch from Journal
Modifica bytecode usando rollback journal com checksum verification.
- Melhor para: Crashes repetidos (3+)
- Overhead: Médio
- Reversibilidade: Via rollback journal

### 3. Component Restart
Reinicia Activity/Service com restauração de estado.
- Melhor para: ANR, componentes travados
- Overhead: Alto
- Reversibilidade: Automática

## Configuração

```typescript
interface LearningEngineConfig {
  storage_path: string;              // Onde armazenar dados
  bug_capacity: number;              // Max eventos (default: 512)
  confidence_threshold: number;      // Min confiança para fix (default: 0.75)
  min_occurrences_before_fix: number; // Min ocorrências (default: 3)
  heartbeat_interval_ms: number;     // Intervalo heartbeat (default: 1000)
  epoch_timeout_ms: number;          // Timeout epoch (default: 5000)
  journal_size: number;              // Size journal (default: 4096)
  max_rollback_attempts: number;     // Max tentativas (default: 3)
}
```

## Testes Locais

### Deploy no Device

```bash
# Compilar TypeScript
npx tsc modules/runtime-learning-engine/*.ts --outDir modules/runtime-learning-engine/dist

# Deploy via Frida
frida -H 127.0.0.1 -p <app-name> -l modules/runtime-learning-engine/dist/index.js

# Ou via ADB
adb push modules/runtime-learning-engine/dist /data/local/tmp/frida-learning/
adb shell frida -p <app-pid> -l /data/local/tmp/frida-learning/dist/index.js
```

### Verificar Arquivos

```bash
# Bug history
adb shell cat /data/local/tmp/frida-learning/bug-history.json | jq

# Rollback journal
adb shell cat /data/local/tmp/frida-learning/rollback-journal.json | jq

# Watchdog events
adb shell cat /data/local/tmp/frida-learning/watchdog-events.json | jq
```

## Integração com Runtime Profiles

Este módulo estende e integra com:
- `runtime-debugger-arm-safety.json` - Arquitetura base com rollback
- `runtime-stability-recorder.json` - Registro de estabilidade

## Limitações Conhecidas

- Requer Android 10+
- Memory API limitada em alguns devices (Memory.ProtectionAllow)
- Circular buffer de 512 eventos (antiga = LRU eviction)
- Rollback funciona apenas em memory-accessible targets

## Roadmap

- [ ] Integração com ML para predição de crashes
- [ ] Dashboard em tempo real (frida-desktop UI)
- [ ] Suporte a multi-process monitoring
- [ ] Sincronização com frida-desktop
- [ ] Persistência de modelos de aprendizado
- [ ] Análise de stack traces com ML
