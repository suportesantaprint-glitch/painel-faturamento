import React, { FormEvent, useEffect, useMemo, useState } from "react";
import "./App.css";
import { supabase } from "./supabase";

type Faturamento = {
  id: number;
  descricao: string;
  valor: number;
  data: string;
  criadoEm: string;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataAtual = new Date().toISOString().slice(0, 10);

function App() {
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(dataAtual);
  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const total = useMemo(
    () => faturamentos.reduce((acc, item) => acc + Number(item.valor), 0),
    [faturamentos]
  );

  async function carregarFaturamentos() {
    try {
      setCarregando(true);
      setErro("");
      const response = await fetch("/api/faturamentos");

      if (!response.ok) {
        throw new Error("Falha ao carregar faturamentos.");
      }

      const dados = (await response.json()) as Faturamento[];
      setFaturamentos(dados);
    } catch (error) {
      setErro("Nao foi possivel carregar os dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregarFaturamentos();
  }, []);

  async function salvarFaturamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const valorNumerico = Number(valor);
    if (!descricao.trim() || !Number.isFinite(valorNumerico) || valorNumerico < 0) {
      setErro("Preencha descricao e valor valido.");
      return;
    }

    try {
      setSalvando(true);
      setErro("");

      const response = await fetch("/api/faturamentos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          descricao: descricao.trim(),
          valor: valorNumerico,
          data,
        }),
      });

      if (!response.ok) {
        const erroDaApi = await response.json().catch(() => ({}));
        const mensagem = String(erroDaApi.mensagem || "Erro ao salvar faturamento.");
        throw new Error(mensagem);
      }

      const novoItem = (await response.json()) as Faturamento;
      setFaturamentos((atual) => [novoItem, ...atual]);
      setDescricao("");
      setValor("");
      setData(dataAtual);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro ao salvar faturamento.";
      setErro(mensagem);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="pagina">
      <section className="card">
        <h1>Controle de Faturamento</h1>
        <p className="subtitulo">Dados salvos em SQLite.</p>

        <form className="formulario" onSubmit={salvarFaturamento}>
          <label>
            Descricao
            <input
              type="text"
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              placeholder="Ex.: Servico mensal"
              required
            />
          </label>

          <label>
            Valor (R$)
            <input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              placeholder="0,00"
              required
            />
          </label>

          <label>
            Data
            <input
              type="date"
              value={data}
              onChange={(event) => setData(event.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </form>

        {erro && <p className="erro">{erro}</p>}

        <div className="resumo">
          <strong>Total:</strong> <span>{moeda.format(total)}</span>
        </div>

        <h2>Lancamentos</h2>
        {carregando ? (
          <p>Carregando...</p>
        ) : faturamentos.length === 0 ? (
          <p>Nenhum lancamento salvo ainda.</p>
        ) : (
          <ul className="lista">
            {faturamentos.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.descricao}</strong>
                  <small>{item.data}</small>
                </div>
                <span>{moeda.format(Number(item.valor))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
