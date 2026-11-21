# RAFAELIA Frida | Ponto-pai, Merkle e carimbo RFC 3161 — V1

**Escopo:** módulo de evidência reproduzível, separado da UI Android e dos produtores RMR/Vectras. **Estado:** IMPLEMENTED_HOST_TESTED_SCOPED; CLOUD_COMMIT=HOLD; claim_allowed=false. Código e testes em tools/rafaelia/custody_anchor_v1.py e tools/rafaelia/test_custody_anchor_v1.py.

## Autoridade e limites

Cadeia: Drive AGENTS.md → START HERE Ω V2.2 → CURRENT_STATE → Frida/AGENTS e docs/START_HERE.md → produtor do recibo. Preserve SOURCE ≠ ARTIFACT ≠ EXECUTION ≠ EVIDENCE ≠ CLAIM. Alterações na branch review/rafaelia-json-custody-core-20261121, PR #87 DRAFT/HOLD; sem merge/publicação adicional ou mutações no Supabase/Drive. A fonte Frida continua sujeita às licenças do upstream, e o RMR BLAKE3 não foi alterado.

O hash do ponto-pai é SHA-256 dos **bytes exatos do receipt anterior** fornecido por --parent-receipt, não o hash de um JSON reformatado. Não invente um pai; quando for realmente um primeiro registro, usar explicitamente --genesis. Guardar o receipt-pai original é indispensável para a reconstrução.

Cada item é um arquivo local escolhido explicitamente e recebe: alias neutro, ordem, tamanho e SHA-256. O caminho, CPF e corpo privado não são colocados no manifesto. Leia via stream; não dependa de nomes de arquivos para identidade. O monitor de metadados detecta alterações comuns durante o hashing; não promete snapshot atômico contra um agente privilegiado.

A raiz de Merkle usa SHA256(0x00 || JSON_CANONICO(item)) nas folhas e SHA256(0x01 || hash_esquerdo || hash_direito) nos nós, com divisão recursiva da maior potência de dois estritamente menor que o número de folhas — composição no estilo RFC 9162. **Não confundir** SHA dos bytes do arquivo, hash da folha, raiz Merkle, hash do manifesto e Git blob SHA-1. Todos são diferentes e têm finalidades diferentes. Cada folha possui prova de inclusão; a verificação negativa deve falhar quando uma folha ou prova muda.

O manifesto é JSON com chaves ordenadas, separadores definidos, UTF-8 e nova linha final. Sem NaN, chaves duplicadas, campos surpresa ou claim permitido. A execução não possui shell arbitrary, URLs remotas, credenciais, chamada à Receita, NTP ou blockchain; ao ler arquivos privados, executar somente em ambiente privado autorizado.

## Quatro ciclos e ponto-pai

1. INPUT: arquivo/receipt-pai original, hash dos inputs, SHA de commit **declarado**, ABI e versão quando comprovados.
2. OUTPUT: origem e destino de cada operação, bytes verificáveis, logs, benchmark com unidades explícitas e margem de erro se medida.
3. CERTIFICAÇÃO: manifesto exato + raiz Merkle → requisição RFC 3161 .tsq com SHA256 e nonce → resposta da TSA .tsr → verificação da assinatura, cadeia de certificação, imprint e nonce.
4. COMMIT ou RETURN: receipt sucessor append-only, readback de Drive/Supabase somente quando autorizado, ACL/lease validados; se faltarem provas, RETURN/HOLD.

O manifesto é fechado **antes** de solicitar a prova temporal. O carimbo incide sobre o hash dos bytes do manifesto, e a resposta externa é gravada em **arquivo filho separado**. Assim não há auto-referência circular. Um protocolo da Receita Federal, um horário NTP ou um número de processo podem entrar como *artefato* com hash, mas só devem ser apresentados como **testemunha criptográfica do manifesto** se o emissor tiver realmente atestado o mesmo digest de forma verificável. A ferramenta não gera nem presume tal atestado.

## Uso mínimo

No diretório da raiz do repositório, com Python 3 e arquivos privados no ambiente local:

    python3 tools/rafaelia/custody_anchor_v1.py build \
      --source-commit "$(git rev-parse HEAD)" \
      --parent-receipt /caminho/receipt_pai.json \
      --item INPUT_JSON=/caminho/entrada.json \
      --item RUNTIME_LOG=/caminho/log.json \
      --out /caminho/manifest.json

Para o primeiro elemento real, substituir --parent-receipt por --genesis, documentando essa decisão; não chamar um vazio de zero. O código exige pai ou gênese explícita.

    python3 tools/rafaelia/custody_anchor_v1.py query \
      --manifest /caminho/manifest.json \
      --out /caminho/solicitacao.tsq

O arquivo .tsq é uma solicitação DER RFC 3161. Encaminhá-lo à ACT apropriada por canal autenticado e autorizado é **uma etapa externa não executada neste código**. A ferramenta não escolhe nem endossa uma ACT e não associa um CPF público ao hash.

Após receber o .tsr, com o certificado-raiz da ACT previamente autenticado por fonte independente:

    python3 tools/rafaelia/custody_anchor_v1.py verify \
      --manifest /caminho/manifest.json \
      --query /caminho/solicitacao.tsq \
      --response /caminho/resposta.tsr \
      --ca-file /caminho/act_raiz_confiavel.pem \
      --untrusted /caminho/cadeia_intermediaria.pem \
      --out /caminho/receipt_verificado.json

Esse passo invoca **OpenSSL** como verificador externo RFC 3161. Não tenta implementar validação de X.509/CMS do zero. Aceitação fica limitada à CA explicitamente fornecida: **o programa não certifica, por si, que a CA é uma autoridade governamental ou da ICP-Brasil**. A confiança no certificado, sua política, eventual revogação, requisitos jurídicos e a hora real da execução precisam de auditoria independente. Uma CA de laboratório autogerada NÃO é uma testemunha temporal independente.

## Verificações e orçamento

Máximo 256 itens, cada arquivo até 512 MiB em stream de 64 KiB; manifesto até 256 KiB; resposta até 4 MiB; consulta OpenSSL com timeout de 20 s. Saídas gravadas em modo exclusivo, sem sobrescrever arquivo existente. Registrar SHA-256 da entrada, da requisição .tsq, da resposta .tsr, da CA e do receipt-filho. Não registrar material privado no GitHub.

Execute testes:

    python3 -m unittest discover -s tools/rafaelia -p 'test_custody_anchor_v1.py' -v

A bateria contempla árvores 1..64 folhas, reconstrução das provas, preservação de zero vs vazio, falsificação de folha/prova, nonce DER, hash incompatível, resposta assinada de CA efêmera de **laboratório**, resposta adulterada, CA errada, duplicação de campo e tentativa de sobrescrita. A CI usa apenas arquivos sintéticos e registra seu SHA-256; o teste com CA efêmera comprova comportamento do verificador relativo à CA escolhida — não anterioridade pública.

## Lacunas tipadas

- APK/Android SAF consumindo este módulo Python: NOT_IMPLEMENTED.
- Assinatura humana de manifesto, certificado ICP-Brasil real, ACT externa, NTS autenticado, blockchain e prova de protocolo RFB vinculada ao mesmo hash: TOKEN_VAZIO_NOT_EXECUTED.
- PMU, energia, consumo elétrico, duração real entre eventos, accuracy e drift NTP: TOKEN_VAZIO_HARDWARE_NOT_MEASURED.
- Geração/renovação de lease, ACL/RLS, aprovação remota e readback Drive/Supabase: BLOCKED_REMOTE_GATE.
- Validação do commit declarado como HEAD do produtor: verificação externa obrigatória; o parâmetro SHA é apenas uma declaração se não houver readback.
- Assinatura pericial e reconhecimento jurídico: requer profissional, cadeia íntegra e escopo especificado.

**Rollback:** correção por sucessor, nunca alteração do receipt-pai; manter branch e PR em DRAFT/HOLD, não mesclar enquanto os gates pendentes forem essenciais.
