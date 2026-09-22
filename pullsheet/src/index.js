/**
 * Exor Pull Sheet — Cloudflare Worker
 * Stores pull-sheet "jobs" in KV and serves a touch-friendly digital pull sheet
 * that any computer/tablet can open by URL. Edits autosave; a per-order
 * "Quarantine" applies the QUARANTINE tag to the Shopify order server-side.
 *
 * Bindings / secrets (see wrangler.toml + deploy steps):
 *   KV namespace binding: JOBS
 *   Secrets: API_TOKEN, SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 *   Vars:    SHOPIFY_API (e.g. "2026-04")
 *
 * Edit STAFF below to your roster.
 */

const STAFF = ['Gage', 'Sydney', 'Beth', 'Sinnis', 'Dresmond', 'Josh', 'Jeff', 'Brandon', 'Sebastian', 'Chaylon', 'Catlin'];
const ADMIN_NAMES = ['Chaylon', 'Catlin'];
const QTAG = 'quarantine1';
const PULL_TAG = 'PULLSHEET';
const PACK_TAG = 'PACKED';
const PRINT_TAG = 'PRINTED';
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAAna0lEQVR42u2cd5hV1bn/P7ucMuecqTADTKGP9KYixaCUgKAUAUGM2BKJqBGN1wJGSTQGFKNXSJAE7CYiQowVVECNIIIoOjAUB2GGgWlML6fvvd/fH2fOdoZiu/fmx32u63nmmZl99ll7re96y/d917u2IiLCj+0HN/VHCH4E8EcAfwTwRwB/bP92AE3TxLKs//UAWJaFYRg/+PvKf5XGWJaFiKCqKoqi/K8BzjRNFEVBVdV/nwTGsW5qauLFF1+ksLAQVVXRNA1FUf5XSGR8DpqmoaoqBw4c4P7772fZsmU2sN+3w+/cLMsSEZFIJCKdO3eWHj16yMUXT5AVK56QcDgsIiKmacqZ2uLjFxF54YXnZdKkSTJy5EhxuVzy5JNPiohINBr9Xn3yQwcxZcoU2bx5s6xd90+ZPHmy9OnTR/Lz889YEONjKioqkuHDh8ull14qL69dJ+Xl5TJo0CA5ePDgDxr79wYwvkKzZ18pa9asE5GQiIj86c/LpUuXLlJXVyeWZbVa7TNB8kzTlEAgIIMHD5bly1c0fxKRN99cLwMHDjhJQr9r+8EWtGNONgcPl2HWbaTiX+P51c030atXT1auXImiKN/flvwPe1pVVVm9+kW6duvOTTfNpeK9cRiNh/jo450MGjToh9m//wqNadeuHdXV5Wiubjhr38Fs3MNPx01h27atZ6zj2LF9Gz+9aBpW9Wu4GjeiJmRytLiQLl26/Ht5oIjgDwRwuz1ghVFQkeBR2rRtj7+pMdaxeuZw9Di9qquvo02bdJTgIdBUEAOfL5HGxkZ+KJtTf8hgFEXhwP595Ob2xAocAstCxMTh0DEM84ylMKZhousaloBiWUiohB69+rJ/3z57Xv/jPFBRFOrq6sjPz2fUqFE0lWwADRQ9iXA4hMPpbKU2Z1JzulwEgwHQE1EEAuWbGTvuEvbsyaOqquoHcVn1uwJnmiaGYaCqKnfddQcXjhpP50ydSMUrWA4FLSGHkpIjtGnT5owDMD6W9LZtqSgvQ/XkIBpES56l11lZjBw5hltvnYeqqpimiWma33n86ncBTlEUNE3D4XDwyB//SN6uXdz/wMPU5t2DbtQirmwUTzZ79+yiV68+Z6wKd+9+FgVf5qN4+2I5HDhCeTQc/At/fHwVO7ZtZdGiRTgcDjuy+i5Aqt+mrpqm0dDQwOuvv87UKVN489VXWLtxC1L5AlL6Z1RNRUkaQWPQSf7uXYwaNeqMcyLxsQw//yfs37uLsGSBtw+iqiiH7yKBPbyz9RP+seYlLpkwgddee43GxsbvFKKqp+NNiqJgGAYLFixg7JgxPPXUU0yYPp23t27DuXUb4cN70BNdiGXh7TKX7ds+JmqYDBkyxE4unEkAiggDBw4kHAqSt+cgnk5zkLCFnuik4ZMPaHu0lO15u5kwdSornniCEcOHc/fddxOJRFBV9fQgni7kKSsrk3POOUfmzJkjhysqxDBMCeTlScFNN8iedmlycPp1Uv/5zXJ865BYaDd5kvzm3t/8oHjy39HiY1q8eLFcP+cGETGk+r3OUr3zIdl7/sWyt2uOHP39/WIeOSKWiOwvLpbLZ86UXr16SWFh4WnDPE4MeSzTlOrqaunTq5csX75cRESO/mmp7LnwJ7K7c7bk57SX/Wf3l32Z6XLwxtkSNqrkw39tlfbt2kl1dfUZF8a1mptlSV1dnfTp01vydu+VkP+Q7J9yiezumC37B/ST/VntZW9uVzlwyXip+sc6ERF59JE/SmaHDlJWVmaHhKcF0DAMERH56Zgx8tDDD4mISN5l0+SL9BTZm9tZ9vXtKQcG9ZP9XXIkv2umVPxjrYQipnTp1FFW/OUvrfo4E1t8bE899ZSMvPACERE5smSx7M7KkP1ndZWCQf3ly9495MuunWRvRpocvuM2ERFZMH++DBs27JTz48TOly5dKpMmThQRkfxrrpbd7dvI/oF9ZX+/XvJl3x6yr1MH2X/xWPHv/EREREaNvFAuv/zyMx68E+c5ceJE+d3vFoqISP2bb8iB84fIvo6Zsr9fLznQt5d8OaCv7M1IkaMPLxIRkXMGDpRly5adNE9aind9fb0M6NdPCkpKpOy55+TzjFTZO7CP7Ot9lnzZt6fs75Ytx5YvFRGRA0VFMnzoUBk/frxYliWGYZyRqnsqG2+aplRWVkpycrJcNG6cHDl+PJbquvN2yc/pIPv69ZR9fXrIgX69ZF+nLAnszpOtn+6UTjk50tTU1MpMqS297ssvv0z/s88mNyOD8j/9J87UVDAMNF1H6utIvOXXZN00j98sWMBFI0Zw0YQJbNiwwaY8/y4CHeen34fwtqRmAG3btmXjxo2cc+65TBgxgiVLltBpyaN4Jl2K1DWAqiKKggqULnmI8885l86dO7N69erW2aaWIjlj+nRZu2GDNG5YL190SJf9/XrJ/r495cvcrnLggvNFLFMefPBB6da1qxQVFX2rqkSj0VY/J147ldSaptnqnhM/P5WZ+Cbpj/fX8vMTHcGRI0dk4ID+smLVKrFqa2V3z1zZ1ztX9vXpIV/27Sl7czuJeeyo/HnlKhl/0UWtxqGKCJqmEY1GOX78OAMHDKT2vc1oqoYAiqpiBvx4R46kybB4etUqPvjXv+jUqRMAtbW1FBUVceirrygtLcXv99t7Drqut/o58VpLxm8Yhs0fW94Tl5g4D9M0jZKSEp5/7jleeP55SsvK7H7ifcTvj+cB4/0UFxdTXFyMqqoEAgGKi4sJhUJ07NiR1994k2f++lfCySl4Bp2N+AOIqiCahhIIUP/BZkaMGUNxURHhcBhN0xAR9Lh4V1ZWgqqSnpxE5aFDKA4HSCz7YolF4lk9OFR8BKfTSd4XX7DowQc5sH8/gWAQRVEQwDJNVEVB13W65uYyfPhwqqurqayspKG2lnA4jKppJCYm0iEzk379+zN+/HjcbretZgUFBWzetIndeXlkZmdz22234fV6bWK+8L77ePP11+k9cCCRUIjFf/gDF0+axH333UdycjIAhmGg67Gp7dmzhxf//nc+/ugjooZBMBwmOTmZaDhMNBrFsiyGn38+9y38LWlpqRwqOkKbrl0JfPg+uqKACKqm07RnN9kzrgCgpKSErl27xgCM24WGhgbcbjcJDgeG34+iKigIKACCqCppbdrgb2zkz8uXM+biS5h988106dQJT3MGxhChvqmJ4+Xl5G/fzp69e1GAjA4d6D34PJxOB0bUoLamhtKjxaxYsYIH7r+f+QsW8OnOnezcsYNwJEKPfv0YOHgw2zZvZuzYsWzfvp28vDx+OWcOuWedxZtbtpDpcEBCAoVVVdx/xx0MHzKE2ddcw6233orH4+GTTz7h/t/9jvq6Oi4YO5bFK1bQs3t3AjU1PPvUU1x6xRW0y8zk6LESVv7nYww7bzAuXSMlNYVIKIw0C4UIoKoYlZV4nE6cLhc1NTV07drV3h+NUZb8fJlw8cViGIYcGDdG9nbrFLN//XrJgdxOcuiySyUUCklFk19MEZGDBVL79FNSfNs8OfyzWXL4iplSNHeOlN59h9S8+KJERcSK25omvxhbt0j4ww8lvOVDMb74XKS0RERElixZIj169JDFjz4qW7/4QhoNQ6S+XqK794iIyIgRI2TGzJkyaEB/Wb1urYiIHHviCcnv11cOjDhfqte9LCIiuwoK5LLp06Vvnz7yxBNPSP9+/eRvq1+SoIhIdZXUPPuMFF13jRz/Ik9ERCr+9ncpnDVTalavFhGR7fn7ZMeXBVJfUip7h54n+T27yr6+PeXLfr1lf+dMOfzzqyQkIoMGDJBPPvnEtqV63MZ4vV5CgQCmoqB7fUQsC5RY4lHxeIh+tpNjV/8M77DhFGzcSCQ/Hy0aQdV0FF1r9kgmIcuk7m/PEeiYg9KzFxIKoZkmdb++BaPoCIo7AUVXkUiEpNv+g7m3/wfXX389qeEwde++zfFlj1P88ceIy0mPHZ+SlZXFkcOHefvDLaTV15M/ZRLWju24UlJQyvxUzLuFqmeepvttt7N23Tre2biRKRdfzPInn+TKiZew/xfXEv74I7S6WjRFxTf/Xsp37qRy/h3oqkLw/fepfHkN3abPwIqEKVnzd5TKclSPF8WyQFUQy0JLSyNsmkSaTUC82TYwPT0dIxqlIRQiITsb/6c7AAVBwLBQfEkYn31K9dYtaAkJuJOSQIsF6QgomgaKguJwoNQcx1i3Bu9Df8QMBHBkZpJy239Qfc9dkJaGYlpowSChV9YSnn01mqKy+5KL4MgR9KRENFHQunamwe/n+uuvZ9iYMfjXvkz+bxbgjITQMztgRaMouo7qSYD9+zh29Wy0ERdy0TPP8v6WLfjatad01QpCa1/C1aUrStsMVFVDKT1Gw8OLUF0OJDERzRIkbxfHt29DEHSfFzxeiCcPVAHLxHNWDyoqq7Asi6ysLDs7r8bTNV6vF6/Hw8HDh0kdNiw2QEVBRGK2wLLA48WRnoHi8SJiIYYBpoliGJhVVZiVFRilx7BEiHzwHnLoK9TERIyaGlxjL8LZpTtWYyOWZYLHg1lyDGvnJ0hTI0pDA46sLNTkFMQy0XJzMd1uhp3/E8ruuYeSW27GpauQmIRZVQ2mgaUpmIaB5fWiZWRg/et9Dl5zFf369iUnJ5twMIye1gZRlNgzrSg1K5ZilhxDUTUUQ7AME7xetPR09PQMcCd8DV7M/COaTsrQ4eze9Rlpbdrg9Xpt7qy2pAgDBg5k0/r1JIy7CCXBgzSTxTiIWM2gxR+gKKiWoLgc+O6+m6QHF5G65BESRo8jeugw/qdWorrcSDiMpKbiu3Qaqj8YI6mWBQLhTe8Q2ZOH+P0oCIoZG5hr5Ggc7gRKfrOAxlVP4MrqAP4g3rHjSFv4OzBBaWgEXcMSC8uIoHZoj7n9I2o3vIWpaSjNC9xcBIQo0PahR8l6bT1qejskFARFi83HNGI/LcFTFAiFUbJy0Pv25+1XX2XI0KGtaJXaMuF4+axZvP3PfyJt2pI85qdYDfUozXQgDqLSkvhLzO6JppMw62ckzL4W12VXkPrnv5A0/x7wJCDhMIrDgdXUhPviS2KrHIkilqD6Eglu30b9ihU4fIkxUxAKonXtSsKYsQQ3bSS0ZjWOrEzEtFBMAy2nIynXz6H9y+twnnceEowtiAWIJSiqgrl3LygKVjBIfJtIsUB1OIlEIihdOpN6591IOATa6SMZRdewGhtIvfwKApbF5nfe4cqrrmqVpLUBtCyLQWefjS/Rx7rXX6PzwvuxNAdiGrGVOB2IKIhYGFVVGFXHiZaXEq6txnvH3STd81usSDg2wVAIpXNn3CNGIP4mRFMQVYWmABwpRHU5UVUFCQZwTrgEzecjuOENFEVQREFtplviTSAYCKJ06UK7v63G2acfij+AqmqxFVVAGhtQASUUipHv+ESt2MBDtXU4Bw9Gz8rBCoft+bWalaaihIJIx060n3sTf12+nOyOHTl70CCboLfKSDcnFnjg9w+y8M67COfk0G7BvUQrKxFdtx9iKSBKawBRFBxpaTjaZqC374CWmoZRW4tRX39CptvEM3EyiqIhCCaCKAo4HCASU7mUVNwXTcAyDKyaWjRVQ4vTUUBxJWCpCpGGeqKGiZacgmIYKC2S7BIMxiYWDqGioH797Ri/s0zw+lAzMpBo9GQAVRVFASMQoMPih6kOhVj0u9/x8JIlNk4neWFN0zDNWEr+4okTuebyy3lpzRr8RYU0Pb0KvX0Gmii2TWmlxZZFZOvWWOclR7HKK3D9fA6kpUJ8gKqK2diEc8gQnGf1IFJ0CHG7ibNVRdOQhjqc4ybg6NYdKxSTDEVRbPQEyzYpqBqIYBmtARDADAdjCxaJ2lGSEtccpXnRLQuzWbtMBK3Z5imajmJGidbUkvzb35MycjQjL7yAy3/2M4YNG4Zpmmiaduo9kfi23qOPPkplZSV33nEHXRctJm3e7Vg1tVj19bYa2MNVVdRIhLo7b6X+jltpevB+Ils+QElJBsNovbpGFJKTSRg/IeY0dL3V7oxlWiRMnBxzWEqzEY/997WEqSpKC3mLAXiC+hkmCsScYNz8xFYKVUDRdazaGsyyUhSXC0VVUVQNDAOrtpJwNELK4kfI+sUvuf7nPycYCrNs2TJM0zxpr0c9seogvgHz1vr1fLRtG3NvuIHse+6h91tv45kwHvG4Y56q1aoraL5E9LZtUXyJOKbNQE1KQk6oUhBFxWhoxHPpVLTMLIhEbOmUQAC9bz/cw3+C2dSIqCfbJVGA+HVFiRHdk2xYi3E1Uw2k2TYCVjiCIzmJ0JYtWMePxz6vq8VorMNMS8E5cxY9N/2LDldezZVXXMGOnTvZvHmzjc2J1Qvq6epI3G43W7ZsobaujvOHDeNDf5CsFU+Scs99mH4/SvNK2PZQ0VCiUcTrxT1uPFYggKIpp9wHtCLhmFfFFjAwDNQ2bVG9XsQ0aY7E7Xvka2PdCiAJR0BRT7ZhcYmPT1hi9s+dk4NVVETdX5ajJbhQ26TinjSZ7Geep/eWHWQ98jhv7clnUP/+NPr97Ny5E5/P1yqX2LLpp6t/iae51qxZw9q1a7n+ilnct2gxV/buxXHLRG+eSMwjC9JYT7S2Gvcvb0LPzSVaVRVTjWZVFBGwLNQELw0vvohVWYHeNj2m5pag+HwYO3cQyd+NmntWjCciCEprAWt+HgpI1EAMs/XERFCcrtifRjSGrTRLrmlS+/AiQls/RK2pRgyDxDvm45t0Kfu/yOPJG29k144dOJxO7rjrLmbPnt2qPO5UTf+mIiIRIRqNMmPGDPI+/5yq+nr0SORr26IAlom4nPh+fS+qz4c+dDhWfT2a243qcmGFw4jZ7CVdLqS8jODGd1CSkpolrfl5qoYE/ITeXk9C334QjaK0UBDla1duX7GMCBJpdjYisTGJhebzNYfmVvM3mz8zTYJ/ewHF40b1+rAq/Wjl5dSWlTPu/OH84oYb+OuqJzl38Lmt9se/aY9b/bZKrLhjaWhowOfzYYVDYNHC7giiO0iYMQv3rCtRklJigXhjI7Wzf0bohedQE5OQaBTN5yP0wXsYJcdQXM6v1VFR7JAqvPEdpLoaxek8wWE1+yyvF5qphGKaKEYUq3ksSrPTUdq1j/1vWrTK+FsWWps2KE43mCaq04X//c3kdGjPoHPOYdSoUZw7+FwMw7AdxrdVbH2n8gFN0zANA6fLhRmJNlunOIcBxMI8dBDrq69QqquQ4iPU3nozofc3oXXuEgNCUSASxf/aayhORyxq+PrMQQxMlwujqJDotq3oTidKoAlLiWVDRARF14ls34bmcqF7fSgRI6bGqmJzM9E0HH37xfpvgZ5iSSz+DofsbDUeD9HPPoOjxVx74408cP/99kK0pCr/LeVt8Syv1XwoxQJMwFQ0JBii8hfXUTlzGlWzLqNy1nSiuz7FOWo0jpGjMOvr0FNSkbzPkbw8XL5kHCKoioIoYLhcmJaFIQqmqhJ449XYJNq3xwwFsVQVyzRREpMIrXmJ+pvnotTWIIaB0VCPqmmoDgc0NaD37kvCkGGYTU0oqtLM7TSs+np848eT9MsbsWprY7SlOV1f/uzTXD5rFvW1tXz44Ye21p1Y3fWDqrPi4myaJgiYhoFL10nWNdo4dNKcDtI0B2nRKEmRAEmRIB7LIFHVSb/yKpyJiViGgWkYlD79FBXVNRz3N+EPRwhXVuIdOoysm36Fr76eVF0jLSkF3xe78JYeo+NdC0hp154Ey8KhaTFpT0oi8NbrlF12KVULf4NqWaA7kMZGLN1B8r0LsRzOWAgqgmDF9EUFKxwm5YYbcXTIwgoHY44qMZHGf75Cgt/Pjbfexm8XLrQLiuJ7LPH/T1Ufo3/TSR5N0+z9ClXTSE1LIyEapri+kWLDojwapcaKqZ6ua6gJbhrDIVLS06l0CNYbbyHvbMTtclFfV0egsBDHuYMJR8I0VFfTpr0Pd2kFbT/eAaKil5SRqum4a6ppu3AhqbOvJnzecJR1L5GRloYPhUSnAz0pBXcoCJ/tRLxeogE/0e7d8S28H33g2USqa9ATEjAti6go6ICqOzCaGjE8HnwzLqd22WNIWzeKwwWVxyn76wrm/sed/PmxR9m4cSNjx461sQgGgyQkJLRyLHHb+I1HvRobG1m3bh0bNmxgw/r1XDx5Mnp9PccrKxk8fgL1wSDtMztQV1dPOBwmJSWZ+oYGLhgxgry8PLRgiNzc7hQWFuJ2u0lt147SYyVYlknf/v0JGwZuTePQwYM0imBGozh1B1VVlTRVVREJBEhp354jBw4Qrq7CEQyh1NXR0edDr6khQ1NpZ0bpMGECPeb/Bl9GBloohNvrJSklheqZ0wnl7UJJTCJccgznVdeQ8IeHUY4coXrmDCKBBhSnC800sBwOer2/lb+9/TZ/euwxnn7mGf75z3+ye/dugsEgLpeL+fPnM3jw4NOflYv/qSgKjz/+OA8++CDV1dWkpKQwZMgQ2mVkMOCcc2jfoQPHS0o4fOgQfr+f0pKSWA7P5SIhIQFLhAS3G0XTCEejRMJhAoEASYmJHDlyhHbt2pHgdmMYBuHm8rGSo0fJPessADp37kzEMBg8eDAlx46hO504XC4MEYaefz6vvvEGB74soFN2NhWlpWguJ5VHinHrGi6PB4/HQ1JKCikb1tOu5jhpPh8dZ1xO5jXX4U5Jw5ORQXjp49Q9+hCkpuLSdYyq4ygzriD5gT9w4bBh5O/bx+DBg+nXrx/RaJTPP/+c6upqsrOzeeCBBxg3blys+LQlgHG1veeee1i+fDkXXHAB/fv3JyUlhVAoxO7du1EgtivVrRt9+/ale/fudOzYkTZt2uDz+XA4HPaW4okVAdFoFF3XCQaDRCIRDMMgGo0SDAYJh8OUl5dTVVVFaWkptbW1HD16lKbGRpqammhsbCQzM5NoJEJ1dTWjR42ifYcOZOfkEAwEMCwLTdOor6+nurqar776ivMuvJDiI0coO3YM3eulobwcMQwSfD5Uv5/Iju0keL0E/H5w6KipqUQ6d43tPvr95ObmEg6HqaqqIiMjgzfffBPDMHjkkUcYP358awDj4C1YsIBQKET37t3Jy8ujuLiY0tJS2rRpw+DBg7nkkksYOnQoLpfr31ok2dDQwLFjxygqKqKwsJADBw5QWlpKY2MjDQ0NeDweEhMT7UXs1asX7TMy8Pv9JHgSaKxvoLq2luycHBobG3F7PKR0yORgQQEokJaWxpHDh7ECAfx+PxUVFUSjUXsTvrCwkClTpvDVV1+xbt06nE5nzBY2b8+haRpLly7ltddeo0uXLmzfvp3U1FQmTJjAhAkTGDBgQCtuFIlEbKId9056i+x1PPxpyebj0U3LU0EtExg2l2uufYk/70SJbtmampqoqqqirKyMiooKysrKKC0tpaqqivLycvxNTZiWRU1Njd1fQkICqSkpVB0/TiQSiRUOJCahqiqZ2dlkZGTQtWtXsrKy6N27N1OnTmXYsGGUlZUxYcIE5s2bZ9M63WoW/U8//ZT77ruPsWPH0qFDB5577jnOPffc0x8ZaN5MjxPtU0Uwp6qVjnuvE0FpWZykNFc3nKooKM5JVVVFVVV8Ph8+n4/OnTt/6/ngxsZGjh49Sk1NDaZp4na78Xq9pKen065du1OS5/Xr1xMOhxk4cCC7du3iuuuus/MENo0RETweD+3bt2fhwoUMGDCglSSoqkppaSnr169n9OjRvPvuu2zcuJFVq1aRlpbG+vXr+eqrr7j55ptxOBxUV1fz7rvv0rdvX3bu3Mmrr75K//79efDBB+2Ve/XVV3n55ZcxTZMXX3zRrjWJA/XMM8/w9NNPM3bsWBYuXEg0GmXTpk3s37+fW265BdM0effdd4lGoyQkJPD0009z5Eis9GTUqFEsXLiQTz/9lFWrVvHll1+i6zq9e/e2zwWvWrWK9957D1VVMQyDYDDI7NmzmT59OoZh2Iu4ePFiLr/8ct544w2mTp1KYmJiq9IRWlYrffDBB5KbmyvBYFAikYhdV/zxxx+Lz+cTQPr3728HcLfeeqs899xzAojP5xPTNOWzzz6Ttm3bCiCPPPKIeL1eAWTSpEmtapW7desmgHTo0MG+Zpqm1NbWyuTJk6VloLhq1SpZs2aNAJKYmCjBYFAmTpwogMyaNUtGjRrV6n5Ajh8/LrfddttJ19esWdPq+S1/ZsyYISIi4XBYLMuSjz76SNLS0uTWW2+Vjh07Sk1NzUklzHpczQzD4MILL2Ts2LHccMMNPPfcc4TDYXRdp6KigqamJhwOByNHjqSpqYkjR47w/vvv09jYiKqqpKamoqoqRUVFVFVV2SfCk5KSCIVCNhGN27uEhAR0XScxMbEVA1i2bBmvv/46P//5z/F6vRQVFTFs2DD+/ve/o6oq7du3JxQKkZ+fj6qqJCYmUldXh67rZGVlceedd/LKK6/w/PPPk5iYiK7ruN1uHnjgAfbv389LL73E6NGjOXTokG0G4vZ5586d9jgURWH+/PlccMEFFBcXc+WVV5Kamtpa+lqGcpqmYRgGy5cvp6CggMcff9z2tHFHEI1GueOOO5g3bx6maRKJRKioqMCyLMLhMAB+v98uWYvTkxNfUBFXGcMwTgqPamtr0TQNy7JsMPv06WM/J25aIpGIHW6Fw2EMwyArK4ubb76Zt99+m1/84heUlpZiGAYOh4Nf//rXrFy5klWrVvHmm2+yePFipk2bhmEYpKSksGfPHqZMmcLevXvRNI1169axbds22rVrR35+Prfffnsr23cSgC294euvv86jjz7KJ598gogQCARaeU+n02mvXCQSaUXC4y+hUBSFUCh00hsxFEUhEonYgLcMhEQEr9eLaZqsWbOGPn36cPfdd9sLAVBRUcGUKVNi5XjN4wkGg3Zp3E9+8hPmzp1LSkoK9c27gqFQiGHDhjF69GiSkpKYOnUq8+fPx9ecN3S5XHTr1o3HH3+c7t27EwgEmDdvHtOmTWPr1q1cc801tG3b1j61ddpkQpx2pKens3z5cubMmWMXLsY9ZzQa5eWXX8ayLDIzM2nbtm2rgsb4vYqiEAwGbbrS8thYS+BPpDSTJ0/G4XAQDAbZt28fS5Ys4YEHHsDhcNh8cMuWLa2yJXFwq6qq+Oijj+jduzcAgUDA7n/79u20adMGh8NBUlKSrUH28V2/33amS5YsIT09nQEDBmCaJr/61a+Is5VvzcbEVXny5MkMGTKElStX2gkFh8PBRRddxAcffEDXrl3ts2UtJbhlhWq8gDH+3fgADh48+HVphKricrnQNI2jR49y3nnnsWvXLu6++25ycnLQdZ0tW7bQ0NAAQHJyMkOHDrXpka7r9qKlpqbyy1/+kttvv52ysjIbWFVVmTJlCsuXL+f48ePU1dXZdu7EY7z19fU8++yzXHHFFWzatIlbbrmF5OTk0+6JqKfLRFuWxVVXXcWnn35KqHmH3zRNbr/9dnbs2MHnn3/O4MGDqaysRFVVgsEgx44da5WM9Hq9RKNRAI4ePcrGjRuZNm0a9913n60+jY2NbNq0iYULFzJt2jQAcnNzeeihh5gzZw6WZREIBGyQ+vTpw9q1a+3JuFwu+7P09HSuu+46Hn74YaZMmWJLqaqqzJ07l61btzJo0CBb/eOL2LJofNmyZfTr1w/TNIlGo4wcOfKbc4LfdJbisssuk927d8sTTzwhuq6Lx+ORyspK+x7TNGXp0qUCiKIokp2dbdOcn/70p/Laa6+JpmnidDpFURSbLrz11luSkZEhuq6Lpmn29RdeeEHWrl0r6enpkpWVJR07dhRAbrjhBrn66qtF13UZPXq0FBYWisvlEkVR5KabbpKePXuKruuiqqrd1+OPPy5Tp04VXdfF6XTa16dMmWLP86qrrhJd1yUzM1Pq6urso2Ddu3eXVatWyaOPPiojR46UL7744rTF7JwOvNWrV8u1114rIiJ33nmnPYCCggIxDMMGUERkwYIFrfjUxIkTpaqqSl555ZWTuNbUqVOlpqbmpOsZGRni9/vlsssuE13X7eujRo2SSCQil1xyiQByzTXXSElJif354sWLJTU1tVVfHo9HGhoaZNCgQSc956OPPrLnOnXqVAGkW7du4vf7bXAWLFggWVlZ8tBDD8ljjz0mY8aMkX/84x+nPAWgnypr0tDQwMqVK3nxxRexLIsePXpwww03MH36dDp16mTHtHHHsWjRIsaNG8crr7zCyJEjbVUcMGAAc+fOJSEhAbfbja7rXHnllXi9XmbPno2IkJiYiNPp5IILLsDtdrN27VoKCwtZuXIl0WiU3//+9zgcDqZOncqkSZOYOXMmfr+fefPmMWPGDAYNGkRhYSHBYJCkpCScTieDBw8mMTGRyZMn06tXL5KTk3E6nWRnZzN8+HA7Th82bBhDhw5l1qxZNk81TZNFixYBsHTpUq699lomT57MSy+9xObNm3nkkUfse+1kwonprAULFpCcnMz8+fNPIo6n2y9RVZVQKERtbS3FxcU0NTUhIvh8PtxuN4mJiaSmpuJ0OvF4PN/a57fFtXE7ezrjfrrr32f/Z9myZdx77708/PDDRCIRtm7ditvt5plnnrGdkH7iu1UKCgrYtGkT77//PpFIpFXSIE4NDh8+TEFBAUePHqW2ttamK3FwkpOT8fl86LpOaWkp4XAYv9/f6t64B3U6nSQkJODz+UhNTSU5Odn+nZSURGJiIh6PB4fDYY+lJZ1oCVJ8HztOeE+5h9G8cHFHGT+b0jLpEWcQ8+bNo0ePHlx77bXMnDmT3r1743a77b41TTs5HzhlyhSuuuoqLrvsMns/4LPPPqOgoIDy8nJbVXJycujSpQtZWVm0adPGFuvv0iKRCA0NDdTX11NXV0d9fT0NDQ3U1NRQU1NDQ0ODnXSNJ17jk9U0DZfLZQPerl07srOzycnJITs7G6/X+70lriXQp9pEP3bsGCNGjKBPnz6sXr3aZhAn5QM3bNjAunXreOqpp8jLy+O9996juLiY3NxcevbsSW5uLtnZ2adVmRNr5053evz7qpZlWQSDQfx+P42NjdTV1XH8+HE7/1deXm5Lt67rZGZm0rFjRzp06EDbtm1xu902T3U4HLhcLjweD6mpqaSkpJz0vNraWsrKyjh06BD5+fnU19cTDAaZOXMm559/fqtSD8WyYtv/TU1NDBo0iAsvvNBODAwfPpwJEyaclH1uGTn80PettEyenup3y76/a//BYJCioiIKCgooLCykrKzMluZ4PB9fjHgs7nA47EAhvoWrKAo+n4+cnBwGDRrEueeeS/fu3U9pWxXLskRRFCoqKnjvvffo0aMH3bp1a3UWIt7pDwXrv/v1JSdmr+OS/X3f0xAMBqmpqaGurg7DMHA6naSmptoh36nU/KQE8em2NeNS9l1LHM6kd8TE7eWpHM2JGfNvMhsnbkecMmqLAxh/8Jkgaf8/JPrEmPi7tv/yO1T/r7cfX4P8I4A/AvgjgP+X2/8D1grTyzSHsV8AAAAASUVORK5CYII=';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;
    try {
      // ── per-user login (username + 4-digit PIN) ──
      if (pathname === '/auth' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const name = String(b.name || '').trim();
        const pin = String(b.pin || '');
        const users = await getUsers(env);
        const rec = users[name];
        if (rec && rec.h === (await pinHash(pin, env))) {
          const sess = await makeSession(env, name);
          return new Response(JSON.stringify({ ok: true, name, admin: isAdmin(name) }), { headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'xgps=' + encodeURIComponent(sess) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30 * 24 * 3600),
          } });
        }
        return json({ error: 'Wrong name or PIN' }, 401);
      }
      if (pathname === '/logout' && req.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'xgps=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        } });
      }
      if (pathname === '/admin/rotate' && req.method === 'POST') {
        const me = await sessionUser(getCookie(req, 'xgps'), env);
        if (!me || !isAdmin(me)) return json({ error: 'unauthorized' }, 401);
        await bumpEpoch(env);
        return new Response(JSON.stringify({ ok: true }), { headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'xgps=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        } });
      }
      if (pathname === '/' || pathname === '') {
        const me = await sessionUser(getCookie(req, 'xgps'), env);
        if (!me) return serveLogin(env);
        return serveApp(env, me);
      }
      if (pathname.startsWith('/api/')) {
        const auth = req.headers.get('Authorization') || '';
        const bearer = auth === `Bearer ${env.API_TOKEN}`;
        const me = await sessionUser(getCookie(req, 'xgps'), env);
        if (!bearer && !me) return json({ error: 'unauthorized' }, 401);
        return api(req, env, pathname, me);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* ───────────────────── PIN session (signed cookie) ───────────────────── */
async function hmacHex(data, key) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let _epoch = null, _epochAt = 0;
async function getEpoch(env) {
  const now = Date.now();
  if (_epoch !== null && (now - _epochAt) < 30000) return _epoch;
  try { _epoch = (await env.JOBS.get('sys:sessionEpoch')) || '0'; } catch (_) { _epoch = _epoch || '0'; }
  _epochAt = now;
  return _epoch;
}
async function bumpEpoch(env) { const v = String(Date.now()); try { await env.JOBS.put('sys:sessionEpoch', v); } catch (_) {} _epoch = v; _epochAt = Date.now(); return v; }
function isAdmin(name) { return ADMIN_NAMES.includes(name); }
async function pinHash(pin, env) { return hmacHex('pin|' + String(pin), env.SESSION_SECRET || env.API_TOKEN || 'x'); }
async function getUsers(env) {
  let raw = null;
  try { raw = await env.JOBS.get('sys:users'); } catch (_) {}
  if (raw) { try { return JSON.parse(raw); } catch (_) {} }
  const u = {};
  for (const n of STAFF) u[n] = { h: await pinHash('1234', env) };
  try { await env.JOBS.put('sys:users', JSON.stringify(u)); } catch (_) {}
  return u;
}
async function saveUsers(env, u) { await env.JOBS.put('sys:users', JSON.stringify(u)); }
async function makeSession(env, name) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const epoch = await getEpoch(env);
  const enc = encodeURIComponent(name);
  const sig = await hmacHex('v3|' + exp + '|' + epoch + '|' + enc, env.SESSION_SECRET || env.API_TOKEN || 'x');
  return 'v3|' + exp + '|' + epoch + '|' + enc + '|' + sig;
}
async function sessionUser(val, env) {
  if (!val) return null;
  const p = val.split('|');
  if (p.length !== 5 || p[0] !== 'v3') return null;
  const exp = +p[1];
  if (!exp || exp < Date.now()) return null;
  if (p[2] !== (await getEpoch(env))) return null;
  const expect = await hmacHex('v3|' + p[1] + '|' + p[2] + '|' + p[3], env.SESSION_SECRET || env.API_TOKEN || 'x');
  if (expect !== p[4]) return null;
  return decodeURIComponent(p[3]);
}
function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
async function serveLogin(env) {
  const users = await getUsers(env);
  const names = Object.keys(users).sort((a, b) => a.localeCompare(b));
  const html = LOGIN_HTML
    .replace('__LOGO__', LOGO)
    .replace('__NAMES__', JSON.stringify(names));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* ───────────────────────── API ───────────────────────── */
async function api(req, env, pathname, me) {
  const parts = pathname.split('/').filter(Boolean); // ['api','jobs', ...]
  const id = parts[2];

  // ── current user ──
  if (parts[1] === 'me') return json({ name: me || null, admin: isAdmin(me) });

  // ── user management (admins only for writes) ──
  if (parts[1] === 'users') {
    const users = await getUsers(env);
    if (req.method === 'GET') {
      const list = Object.keys(users).sort((a, b) => a.localeCompare(b)).map((n) => ({ name: n, admin: isAdmin(n) }));
      return json({ users: list });
    }
    if (!isAdmin(me)) return json({ error: 'Admins only' }, 403);
    const b = await req.json().catch(() => ({}));
    const op = parts[2] || 'add';
    const name = String(b.name || '').trim();
    if (op === 'add') {
      if (!name) return json({ error: 'Name required' }, 400);
      if (users[name]) return json({ error: 'That name already exists' }, 409);
      const pin = String(b.pin || '1234');
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN must be 4 digits' }, 400);
      users[name] = { h: await pinHash(pin, env) };
      await saveUsers(env, users);
      return json({ ok: true });
    }
    if (op === 'pin') {
      if (!users[name]) return json({ error: 'No such user' }, 404);
      const pin = String(b.pin || '');
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN must be 4 digits' }, 400);
      users[name] = { h: await pinHash(pin, env) };
      await saveUsers(env, users);
      return json({ ok: true });
    }
    if (op === 'remove') {
      if (!users[name]) return json({ error: 'No such user' }, 404);
      if (isAdmin(name)) return json({ error: 'Admins cannot be removed' }, 400);
      delete users[name];
      await saveUsers(env, users);
      return json({ ok: true });
    }
    return json({ error: 'unknown user op' }, 404);
  }

  // ── cheap change-signature for polling (1 list op, no per-job reads) ──
  if (parts[1] === 'joblist') {
    const list = await env.JOBS.list({ prefix: 'job:' });
    const sig = list.keys.map((k) => { const m = k.metadata || {}; return k.name.slice(4) + ':' + (m.status || '') + ':' + (m.pulled || 0) + ':' + (m.packed || 0) + ':' + (m.archived ? 1 : 0); }).join('|');
    return json({ sig });
  }

  // ── staff stats (admins only) ──
  if (parts[1] === 'stats') {
    if (!isAdmin(me)) return json({ error: 'Admins only' }, 403);
    const url = new URL(req.url);
    const days = url.searchParams.get('days');
    const since = (days && days !== 'all') ? (Date.now() - (+days) * 86400000) : 0;
    const inWin = (iso) => { if (!since) return true; const t = Date.parse(iso || ''); return !isNaN(t) && t >= since; };
    const list = await env.JOBS.list({ prefix: 'job:' });
    const per = {};
    const recent = [];
    const bump = (name) => { if (!per[name]) per[name] = { name, picks: 0, packed: 0, pickMs: 0, pickN: 0, mistakes: 0 }; return per[name]; };
    await Promise.all(list.keys.map(async (k) => {
      const job = await env.JOBS.get(k.name, 'json');
      if (!job || !job.state || !job.state.orders) return;
      const nameByCid = {};
      for (const c of allCards(job)) nameByCid[c.cid] = c.card || c.collector || c.cid;
      const orders = job.state.orders;
      for (const oname of Object.keys(orders)) {
        const os = orders[oname] || {};
        const picks = os.picks || {};
        for (const cid of Object.keys(picks)) { const p = picks[cid]; if (p && p.by && inWin(p.at)) bump(p.by).picks++; }
        if (os.status === 'packed' && os.packedBy && inWin(os.packedAt)) {
          const e = bump(os.packedBy); e.packed++;
          if (os.startedAt && os.packedAt) { const d = new Date(os.packedAt) - new Date(os.startedAt); if (d > 0) { e.pickMs += d; e.pickN++; } }
        }
        const ms = os.mistakes || {};
        for (const cid of Object.keys(ms)) {
          const m = ms[cid];
          if (!m || !inWin(m.reportedAt)) continue;
          if (m.by) bump(m.by).mistakes++;
          recent.push({ jobId: job.id, order: oname, cid, card: nameByCid[cid] || cid, by: m.by || '—', pickedAt: m.pickedAt || '', reportedAt: m.reportedAt || '', reportedBy: m.reportedBy || '', durationMs: (m.durationMs != null ? m.durationMs : null), note: m.note || '' });
        }
      }
    }));
    recent.sort((a, b) => (b.reportedAt || '').localeCompare(a.reportedAt || ''));
    const people = Object.values(per)
      .map((e) => ({ name: e.name, picks: e.picks, packed: e.packed, totalPickMs: e.pickMs || 0, avgPickMs: e.pickN ? Math.round(e.pickMs / e.pickN) : null, mistakes: e.mistakes }))
      .sort((a, b) => (b.picks - a.picks) || (b.packed - a.packed));
    return json({ people, recent: recent.slice(0, 50) });
  }

  if (parts[1] !== 'jobs') return json({ error: 'unknown route' }, 404);

  // POST /api/jobs  → create
  if (!id && req.method === 'POST') {
    const payload = await req.json();
    const jobId = await newId(env);
    const createdAt = new Date().toISOString();
    // assign stable card ids
    let n = 0;
    for (const g of payload.games || []) for (const s of g.sets || []) for (const c of s.cards || []) c.cid = 'c' + (n++);
    for (const c of payload.sealed || []) c.cid = 'c' + (n++);
    const total = n;
    const job = {
      id: jobId, createdAt,
      orders: payload.orders || [],
      games: payload.games || [],
      sealed: payload.sealed || [],
      total,
      state: { status: 'open', found: {}, cardNotes: {}, note: '', quarantined: {}, workedBy: [], archived: false, lastSavedBy: '', lastSavedAt: createdAt },
    };
    await put(env, jobId, job);
    return json({ id: jobId });
  }

  // GET /api/jobs  → list (counts computed live from each job, newest first)
  if (!id && req.method === 'GET') {
    const list = await env.JOBS.list({ prefix: 'job:' });
    const jobs = await Promise.all(list.keys.map(async (k) => {
      const jid = k.name.slice(4);
      const job = await env.JOBS.get(k.name, 'json');
      if (!job) return { id: jid, ...(k.metadata || {}) };
      const cards = allCards(job);
      const found = job.state.found || {}, q = job.state.quarantined || {};
      let pulled = 0, short = 0;
      for (const c of cards) { const f = +found[c.cid] || 0; if (f >= c.qty) pulled++; else if (f > 0) short++; }
      const ords = (job.orders || []).length;
      const packed = (job.orders || []).filter((o) => job.state.orders && job.state.orders[o.name] && job.state.orders[o.name].status === 'packed').length;
      const orderStats = (job.orders || []).slice(0, 60).map((o) => {
        const os = (job.state.orders && job.state.orders[o.name]) || {};
        const of = os.found || {}, oref = os.refunded || {};
        let p = 0, t = 0;
        cardsForOrder(job, o.name).forEach((x) => { t += x.need; p += oref[x.cid] ? x.need : Math.min(+of[x.cid] || 0, x.need); });
        return { n: o.name, p, t, packed: os.status === 'packed' };
      });
      return {
        id: jid,
        createdAt: job.createdAt,
        status: job.state.status,
        total: cards.length,
        pulled, short,
        quarantined: Object.values(q).filter(Boolean).length,
        orders: ords,
        packed,
        orderNames: (job.orders || []).map((o) => o.name).slice(0, 60),
        orderStats,
        workedBy: job.state.workedBy || [],
        archived: !!job.state.archived,
        games: gameCategories(job),
      };
    }));
    jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return json({ jobs });
  }

  if (id) {
    const job = await env.JOBS.get('job:' + id, 'json');
    if (!job) return json({ error: 'not found' }, 404);

    // GET one
    if (req.method === 'GET') {
      if (!isAdmin(me)) {
        const clone = JSON.parse(JSON.stringify(job));
        if (clone.state && clone.state.orders) for (const k of Object.keys(clone.state.orders)) { if (clone.state.orders[k]) delete clone.state.orders[k].mistakes; }
        return json(clone, 200, { staff: STAFF });
      }
      return json(job, 200, { staff: STAFF });
    }

    // PUT → save state (legacy full-state save; kept for compatibility)
    if (req.method === 'PUT') {
      const body = await req.json();
      const s = job.state;
      const incoming = body.state || {};
      // merge mutable fields
      if (incoming.found) s.found = incoming.found;
      if (incoming.cardNotes) s.cardNotes = incoming.cardNotes;
      if (typeof incoming.note === 'string') s.note = incoming.note;
      if (typeof incoming.archived === 'boolean') s.archived = incoming.archived;
      if (incoming.status) {
        if (incoming.status === 'complete') {
          const rem = remainingCards(job);
          if (rem > 0) return json({ error: rem + ' card(s) not pulled or quarantined', remaining: rem }, 409);
        }
        s.status = incoming.status;
      }
      const who = body.employee || '';
      if (who) { s.lastSavedBy = who; if (!s.workedBy.includes(who)) s.workedBy.push(who); }
      s.lastSavedAt = new Date().toISOString();
      await put(env, id, job);
      return json({ ok: true, state: s });
    }

    // POST /api/jobs/:id/patch  → apply ONE field change atomically (concurrent-safe)
    if (parts[3] === 'patch' && req.method === 'POST') {
      const body = await req.json();
      const s = job.state;
      const who = body.employee || '';
      switch (body.op) {
        case 'found':
          if (!body.cid) return json({ error: 'missing cid' }, 400);
          s.found[body.cid] = Math.max(0, +body.value || 0);
          break;
        case 'cardNote':
          if (!body.cid) return json({ error: 'missing cid' }, 400);
          s.cardNotes[body.cid] = String(body.value || '');
          break;
        case 'note':
          s.note = String(body.value || '');
          break;
        case 'status':
          if (body.value === 'complete') {
            const rem = remainingCards(job);
            if (rem > 0) return json({ error: rem + ' card(s) not pulled or quarantined', remaining: rem }, 409);
          }
          s.status = body.value === 'complete' ? 'complete' : 'open';
          break;
        default:
          return json({ error: 'unknown op' }, 400);
      }
      if (who) { s.lastSavedBy = who; if (!s.workedBy.includes(who)) s.workedBy.push(who); }
      s.lastSavedAt = new Date().toISOString();
      await put(env, id, job);
      return json({ ok: true, lastSavedAt: s.lastSavedAt, lastSavedBy: s.lastSavedBy, workedBy: s.workedBy, status: s.status });
    }

    // POST /api/jobs/:id/opatch  → one field on a single ORDER's packing state
    if (parts[3] === 'opatch' && req.method === 'POST') {
      const body = await req.json();
      const order = body.order;
      if (!order) return json({ error: 'missing order' }, 400);
      const os = orderState(job, order);
      switch (body.op) {
        case 'found': if (!body.cid) return json({ error: 'missing cid' }, 400); { const v = Math.max(0, +body.value || 0); os.found[body.cid] = v; recordPick(os, body.cid, v, me || body.employee || ''); } break;
        case 'allFound': cardsForOrder(job, order).forEach((x) => { if (!os.refunded[x.cid]) { os.found[x.cid] = x.need; recordPick(os, x.cid, x.need, me || body.employee || ''); } }); break;
        case 'note': if (!body.cid) return json({ error: 'missing cid' }, 400); os.notes[body.cid] = String(body.value || ''); break;
        case 'refund': if (!body.cid) return json({ error: 'missing cid' }, 400); os.refunded[body.cid] = body.value !== false; break;
        case 'orderNote': os.note = String(body.value || ''); break;
        default: return json({ error: 'unknown op' }, 400);
      }
      stampOrder(os, me || body.employee || '');
      await put(env, id, job);
      return json({ ok: true, lastSavedAt: os.lastSavedAt, lastSavedBy: os.lastSavedBy });
    }

    // POST /api/jobs/:id/mistake  → flag/unflag a card as WRONG CARD SENT (accountability log)
    if (parts[3] === 'mistake' && req.method === 'POST') {
      const body = await req.json();
      const order = body.order, cid = body.cid, on = body.on !== false;
      if (!order || !cid) return json({ error: 'missing order/cid' }, 400);
      const os = orderState(job, order);
      if (on) {
        const pick = os.picks[cid] || null;
        const dur = (os.packedAt && os.startedAt) ? (new Date(os.packedAt) - new Date(os.startedAt)) : null;
        os.mistakes[cid] = {
          by: (pick && pick.by) || os.packedBy || os.lastSavedBy || '',
          pickedAt: (pick && pick.at) || '',
          reportedAt: new Date().toISOString(),
          reportedBy: me || body.employee || '',
          durationMs: (dur != null && dur >= 0) ? dur : null,
          note: String(body.note || ''),
        };
      } else {
        delete os.mistakes[cid];
      }
      stampOrder(os, me || body.employee || '');
      await put(env, id, job);
      return json({ ok: true, mistake: on ? os.mistakes[cid] : null });
    }

    // POST /api/jobs/:id/pack  → finalize an order; tag it PACKED in Shopify
    if (parts[3] === 'pack' && req.method === 'POST') {
      const body = await req.json();
      const order = body.order, packed = body.packed !== false;
      const og = (job.orders || []).find((o) => o.name === order);
      if (!og) return json({ error: 'unknown order' }, 404);
      const os = orderState(job, order);
      const verifier = me || body.employee || '';
      if (packed) {
        const rem = orderRemaining(job, order);
        if (rem > 0) return json({ error: rem + ' item(s) not found or refunded', remaining: rem }, 409);
        // 4-eye: the verifier who packs must differ from anyone who picked the order
        const pickers = new Set();
        if (os.startedBy) pickers.add(os.startedBy);
        for (const cid of Object.keys(os.picks || {})) { const b = os.picks[cid] && os.picks[cid].by; if (b) pickers.add(b); }
        if (verifier && pickers.has(verifier)) {
          if (!isAdmin(me)) return json({ error: 'Four-eye check: you picked this order, so a different staff member must verify and pack it.', fourEye: true, picker: verifier }, 409);
          if (!body.override) return json({ error: 'You picked this order. Four-eye policy normally needs a different verifier.', fourEye: true, canOverride: true }, 409);
          os.verifyOverride = { by: verifier, at: new Date().toISOString() };
        }
      }
      if (packed) {
        // Finalizing tags every order in the pull sheet: PACKED + PRINTED
        const warnings = [];
        for (const o of job.orders || []) {
          if (!o.gid) continue;
          const res = await tagOrder(env, o.gid, [PACK_TAG, PRINT_TAG], true);
          const ue = ((res && res.data && res.data.tagsAdd) || {}).userErrors || [];
          if (ue.length) warnings.push(o.name + ': ' + ue.map((e) => e.message).join(', '));
        }
        if (warnings.length && !(job.orders || []).some((o) => o.gid)) return json({ error: warnings.join(' | ') }, 502);
      } else if (og.gid) {
        // Un-finalizing just removes PACKED from this order (PRINTED stays)
        await tagOrder(env, og.gid, PACK_TAG, false);
      }
      os.status = packed ? 'packed' : 'open';
      if (packed) { os.packedAt = new Date().toISOString(); os.packedBy = verifier; }
      else { os.packedAt = ''; os.packedBy = ''; }
      stampOrder(os, verifier);
      await put(env, id, job);
      return json({ ok: true });
    }

    // POST /api/jobs/:id/ofill  → mark every non-refunded card in an order as found
    if (parts[3] === 'ofill' && req.method === 'POST') {
      const body = await req.json();
      const order = body.order;
      const og = (job.orders || []).find((o) => o.name === order);
      if (!og) return json({ error: 'unknown order' }, 404);
      const os = orderState(job, order);
      for (const x of cardsForOrder(job, order)) { if (!os.refunded[x.cid]) { os.found[x.cid] = x.need; recordPick(os, x.cid, x.need, me || body.employee || ''); } }
      stampOrder(os, me || body.employee || '');
      await put(env, id, job);
      return json({ ok: true });
    }

    // POST /api/jobs/:id/flash  -> blink the ESL shelf tags for this sheet (or one order)
    if (parts[3] === 'flash' && req.method === 'POST') {
      if (!env.ESL_KEY) return json({ error: 'ESL_KEY secret not configured on this Worker' }, 500);
      const body = await req.json().catch(() => ({}));
      const order = body.order || null;
      let cards = allCards(job);
      if (order) cards = cards.filter((c) => (c.orders || []).some((o) => o.name === order));
      const skus = [...new Set(cards.map((c) => String(c.sku || '').trim()).filter(Boolean))].slice(0, 100);
      if (!skus.length) return json({ error: 'No SKUs on this ' + (order ? 'order' : 'sheet') }, 400);
      const r = await fetch('https://esl.exorgames.com/staff-tags/flash-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: env.ESL_KEY, skus }),
      });
      const jj = await r.json().catch(() => ({ error: 'bad response from ESL server' }));
      return json(jj, r.ok ? 200 : 502);
    }

    // POST /api/jobs/:id/address  → live shipping address from Shopify (for labels)
    if (parts[3] === 'address' && req.method === 'POST') {
      const body = await req.json();
      const og = (job.orders || []).find((o) => o.name === body.order);
      if (!og || !og.gid) return json({ error: 'unknown order' }, 404);
      const q = `query($id:ID!){ order(id:$id){ name email totalPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } shippingLine { title } customer { displayName numberOfOrders } billingAddress { name } shippingAddress { name company address1 address2 city provinceCode zip countryCodeV2 } } }`;
      const r = await shopQuery(env, q, { id: og.gid });
      const o = r && r.data && r.data.order;
      if (!o) return json({ error: 'address lookup failed' }, 502);
      const customerName = (o.customer && o.customer.displayName) || (o.billingAddress && o.billingAddress.name) || (o.shippingAddress && o.shippingAddress.name) || '';
      const total = (o.totalPriceSet && o.totalPriceSet.shopMoney) ? Number(o.totalPriceSet.shopMoney.amount)
        : (o.currentTotalPriceSet && o.currentTotalPriceSet.shopMoney) ? Number(o.currentTotalPriceSet.shopMoney.amount) : null;
      const shippingMethod = (o.shippingLine && o.shippingLine.title) || '';
      const isLTM = shippingMethod.trim().toLowerCase().startsWith('lettermail - no tracking - bubble mailer');
      // "First order" only changes the result when it would flip LTM→EXP, so only resolve it then.
      let firstOrder = false;
      if (isLTM && total != null && total > 75) {
        const noo = (o.customer && o.customer.numberOfOrders != null) ? Number(o.customer.numberOfOrders) : null;
        if (noo != null) firstOrder = noo <= 1;
        else if (o.email) {
          try {
            const r2 = await shopQuery(env, `query($q:String!){ orders(first:2, query:$q){ edges { node { id } } } }`, { q: 'email:' + o.email });
            const edges = (r2 && r2.data && r2.data.orders && r2.data.orders.edges) || [];
            firstOrder = edges.length <= 1;
          } catch (e) {}
        }
      }
      const code = isLTM ? ((firstOrder && total != null && total > 75) ? 'EXP' : 'LTM') : 'EXP';
      return json({ name: o.name, address: o.shippingAddress || null, customerName, total, firstOrder, shippingMethod, code });
    }

    // POST /api/jobs/:id/quarantine  → flag a CARD; tag the order(s) holding it
    if (parts[3] === 'quarantine' && req.method === 'POST') {
      const body = await req.json();
      const cid = body.cid, on = body.on !== false, who = body.employee || '';
      if (!cid) return json({ error: 'missing cid' }, 400);
      job.state.quarantined[cid] = on;

      // name -> gid map for this job
      const gidByName = {};
      for (const o of job.orders || []) gidByName[o.name] = o.gid;

      // which order names are still referenced by ANY quarantined card?
      const cards = allCards(job);
      const stillQ = new Set();
      for (const c of cards) if (job.state.quarantined[c.cid]) for (const o of (c.orders || [])) stillQ.add(o.name);

      // the orders touched by THIS card → set their tag to match desired state
      const touched = new Set((cards.find((c) => c.cid === cid) || {}).orders ? (cards.find((c) => c.cid === cid).orders).map((o) => o.name) : []);
      const failures = [];
      for (const name of touched) {
        const gid = gidByName[name];
        if (!gid) continue;
        const shouldTag = stillQ.has(name);
        const res = await tagOrder(env, gid, QTAG, shouldTag);
        const ue = (res && res.data && (res.data.tagsAdd || res.data.tagsRemove) || {}).userErrors || [];
        if (ue.length) failures.push(name + ': ' + ue.map((e) => e.message).join(', '));
      }
      if (failures.length) return json({ error: failures.join(' | ') }, 502);

      if (who) { job.state.lastSavedBy = who; if (!job.state.workedBy.includes(who)) job.state.workedBy.push(who); }
      job.state.lastSavedAt = new Date().toISOString();
      await put(env, id, job);
      return json({ ok: true });
    }

    // POST /api/jobs/:id/archive  → archive/restore, optionally strip tags from orders
    if (parts[3] === 'archive' && req.method === 'POST') {
      const body = await req.json();
      const archived = body.archived !== false;
      const who = body.employee || '';
      if (archived && body.removeTags) {
        const fails = [];
        for (const o of job.orders || []) {
          if (!o.gid) continue;
          const res = await tagOrder(env, o.gid, [PULL_TAG, QTAG], false);
          const ue = (res && res.data && res.data.tagsRemove || {}).userErrors || [];
          if (ue.length) fails.push(o.name + ': ' + ue.map((e) => e.message).join(', '));
        }
        if (fails.length) return json({ error: fails.join(' | ') }, 502);
      }
      job.state.archived = archived;
      if (who) { job.state.lastSavedBy = who; if (!job.state.workedBy.includes(who)) job.state.workedBy.push(who); }
      job.state.lastSavedAt = new Date().toISOString();
      await put(env, id, job);
      return json({ ok: true });
    }

    // POST /api/jobs/:id/delete  → permanently remove the sheet; optionally strip chosen tags from its orders (admins only)
    if (parts[3] === 'delete' && req.method === 'POST') {
      if (!isAdmin(me)) return json({ error: 'Admins only' }, 403);
      const body = await req.json().catch(() => ({}));
      const remove = Array.isArray(body.removeTags) ? body.removeTags.map((t) => String(t).trim()).filter(Boolean) : [];
      const warnings = [];
      if (remove.length) {
        for (const o of job.orders || []) {
          if (!o.gid) continue;
          try {
            const res = await tagOrder(env, o.gid, remove, false);
            const ue = ((res && res.data && res.data.tagsRemove) || {}).userErrors || [];
            if (ue.length) warnings.push(o.name + ': ' + ue.map((e) => e.message).join(', '));
          } catch (e) { warnings.push(o.name + ': ' + (e.message || 'tag removal failed')); }
        }
      }
      await env.JOBS.delete('job:' + id);
      return json({ ok: true, warnings });
    }
  }

  return json({ error: 'unknown route' }, 404);
}

const GAME_PATTERNS = [
  ['pokemon', /pok[eé]mon|pkmn?|\bptcg\b/i],
  ['mtg', /magic|\bmtg\b/i],
  ['yugioh', /yu-?gi-?oh|\bygo\b/i],
  ['lorcana', /lorcana/i],
  ['swu', /star\s*wars|\bswu\b/i],
  ['onepiece', /one\s*piece|\boptcg\b/i],
  ['riftbound', /rift\s*bound|\brbg\b/i],
];
function gameCategories(job) {
  const set = new Set();
  for (const g of job.games || []) {
    const name = String(g.game || '');
    for (const [key, re] of GAME_PATTERNS) { if (re.test(name)) { set.add(key); break; } }
  }
  return [...set];
}
function allCards(job) {
  const out = [];
  for (const g of job.games || []) for (const s of g.sets || []) for (const c of s.cards || []) out.push(c);
  for (const c of job.sealed || []) out.push(c);
  return out;
}

// cards that are neither fully found nor quarantined → block completion
function remainingCards(job) {
  const found = job.state.found || {}, q = job.state.quarantined || {};
  return allCards(job).filter((c) => !((+found[c.cid] || 0) >= c.qty || q[c.cid])).length;
}

// ── Per-order packing ──
function cardsForOrder(job, orderName) {
  const out = [];
  for (const c of allCards(job)) {
    const oo = (c.orders || []).find((o) => o.name === orderName);
    if (oo) out.push({ cid: c.cid, need: oo.qty });
  }
  return out;
}
function orderState(job, orderName) {
  job.state.orders = job.state.orders || {};
  if (!job.state.orders[orderName]) job.state.orders[orderName] = { found: {}, notes: {}, refunded: {}, note: '', status: 'open', workedBy: [], lastSavedBy: '', lastSavedAt: '' };
  const os = job.state.orders[orderName];
  if (!os.picks) os.picks = {};
  if (!os.mistakes) os.mistakes = {};
  if (os.startedAt === undefined) os.startedAt = '';
  if (os.startedBy === undefined) os.startedBy = '';
  if (os.packedAt === undefined) os.packedAt = '';
  if (os.packedBy === undefined) os.packedBy = '';
  return os;
}
// record who picked a card and when (and stamp the order's pick-start)
function recordPick(os, cid, qty, who) {
  os.picks = os.picks || {};
  if (qty > 0) {
    const now = new Date().toISOString();
    os.picks[cid] = { by: who || '', at: now };
    if (!os.startedAt) { os.startedAt = now; os.startedBy = who || ''; }
  } else {
    delete os.picks[cid];
  }
}
function orderRemaining(job, orderName) {
  const os = orderState(job, orderName);
  const q = job.state.quarantined || {};
  return cardsForOrder(job, orderName).filter((x) => !(((+os.found[x.cid] || 0) >= x.need) || os.refunded[x.cid] || q[x.cid])).length;
}
function stampOrder(os, who) { if (who) { os.lastSavedBy = who; if (!os.workedBy.includes(who)) os.workedBy.push(who); } os.lastSavedAt = new Date().toISOString(); }

async function put(env, id, job) {
  const cards = allCards(job);
  const found = job.state.found || {};
  let pulled = 0, short = 0;
  for (const c of cards) {
    const f = +found[c.cid] || 0;
    if (f >= c.qty) pulled++;
    else if (f > 0) short++;
  }
  const quarantined = Object.values(job.state.quarantined || {}).filter(Boolean).length;
  const ordersTotal = (job.orders || []).length;
  const packed = (job.orders || []).filter((o) => (job.state.orders && job.state.orders[o.name] && job.state.orders[o.name].status === 'packed')).length;
  await env.JOBS.put('job:' + id, JSON.stringify(job), {
    metadata: {
      createdAt: job.createdAt,
      status: job.state.status,
      total: job.total,
      pulled,
      short,
      quarantined,
      orders: ordersTotal,
      packed,
      orderNames: (job.orders || []).map((o) => o.name).slice(0, 60),
      workedBy: job.state.workedBy,
      archived: !!job.state.archived,
    },
  });
}

/* ─────────────────── Shopify (server side) ─────────────── */
async function shopToken(env) {
  const cached = await env.JOBS.get('sys:shoptoken', 'json');
  if (cached && cached.exp > Date.now()) return cached.token;
  const r = await fetch(`https://${env.SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('shop token: ' + JSON.stringify(j));
  const exp = Date.now() + ((j.expires_in || 86400) - 300) * 1000;
  await env.JOBS.put('sys:shoptoken', JSON.stringify({ token: j.access_token, exp }));
  return j.access_token;
}

async function shopQuery(env, query, variables) {
  const token = await shopToken(env);
  const r = await fetch(`https://${env.SHOP}/admin/api/${env.SHOPIFY_API || '2026-04'}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function tagOrder(env, gid, tags, add) {
  const arr = Array.isArray(tags) ? tags : [tags];
  const token = await shopToken(env);
  const mutation = add
    ? `mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{message}}}`
    : `mutation($id:ID!,$tags:[String!]!){tagsRemove(id:$id,tags:$tags){userErrors{message}}}`;
  const r = await fetch(`https://${env.SHOP}/admin/api/${env.SHOPIFY_API || '2026-04'}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: mutation, variables: { id: gid, tags: arr } }),
  });
  return r.json();
}

/* ───────────────────────── utils ───────────────────────── */
// Sequential serial: 12-digit zero-padded, increments by 1 per sheet.
// Counter lives in KV (sys:seq); existence check guards against any race.
async function newId(env) {
  let n = parseInt((await env.JOBS.get('sys:seq')) || '0', 10) || 0;
  for (let tries = 0; tries < 50; tries++) {
    n++;
    const id = String(n).padStart(12, '0');
    if (!(await env.JOBS.get('job:' + id))) { await env.JOBS.put('sys:seq', String(n)); return id; }
  }
  return String(Date.now()).slice(-12);
}
function json(obj, status = 200, extra) {
  if (extra) obj = { ...obj, ...extra };
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/* ─────────────────────── the app ───────────────────────── */
function serveApp(env, me) {
  const html = APP_HTML
    .replace('__API_TOKEN__', env.API_TOKEN || '')
    .replace('__STAFF__', JSON.stringify(STAFF))
    .replace('__STORE__', (env.SHOP || '').split('.')[0] || '')
    .replace('__WHO__', (me || '').replace(/"/g, ''))
    .replace('__ADMIN__', isAdmin(me) ? 'true' : 'false')
    .replace('__LOGO__', LOGO);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const LOGIN_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exor Pull Sheet — Sign in</title>
<style>
  :root{--accent:#d8232a; --ink:#1a1a1a; --line:#e6e3df; --mut:#777}
  *{box-sizing:border-box}
  body{margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
       background:#f3f3f1; color:var(--ink); font:16px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .box{background:#fff; border:1px solid var(--line); border-radius:16px; padding:28px 24px; width:min(420px,94vw);
       box-shadow:0 18px 50px rgba(0,0,0,.08); text-align:center}
  .box img{height:60px; width:auto; margin-bottom:12px}
  h1{font-size:18px; margin:0 0 4px} p{color:var(--mut); font-size:13px; margin:0 0 18px}
  .grid{display:grid; grid-template-columns:repeat(2,1fr); gap:10px}
  .grid button{font:inherit; font-weight:700; padding:14px 10px; border:1px solid var(--line); border-radius:12px;
               background:#fafafa; color:var(--ink); cursor:pointer}
  .grid button:active{transform:scale(.98)}
  input{width:100%; font:inherit; text-align:center; letter-spacing:.4em; font-weight:700; padding:14px;
        border:1px solid var(--line); border-radius:12px; margin-bottom:12px}
  .go{width:100%; font:inherit; font-weight:700; padding:13px; border:0; border-radius:12px;
      background:var(--ink); color:#fff; cursor:pointer}
  .back{background:none;border:0;color:var(--mut);font:inherit;cursor:pointer;margin-top:14px;text-decoration:underline}
  .err{color:var(--accent); font-size:13px; font-weight:700; min-height:18px; margin-top:10px}
  .hide{display:none}
</style></head><body>
<div class="box">
  <img src="__LOGO__" alt="Exor Pull Sheet">
  <h1>Pull Sheet</h1>
  <div id="step1">
    <p>Who are you?</p>
    <div class="grid" id="grid"></div>
  </div>
  <div id="step2" class="hide">
    <p>Enter PIN for <b id="who2"></b></p>
    <input id="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
    <button class="go" id="go">Sign in</button>
    <div class="err" id="err"></div>
    <button class="back" id="back">← choose a different name</button>
  </div>
</div>
<script>
  var NAMES = __NAMES__;
  var who = '';
  var grid=document.getElementById('grid'), step1=document.getElementById('step1'), step2=document.getElementById('step2');
  var pin=document.getElementById('pin'), go=document.getElementById('go'), err=document.getElementById('err'), who2=document.getElementById('who2');
  NAMES.forEach(function(n){
    var b=document.createElement('button'); b.textContent=n;
    b.onclick=function(){ who=n; who2.textContent=n; step1.classList.add('hide'); step2.classList.remove('hide'); pin.value=''; err.textContent=''; setTimeout(function(){pin.focus();},50); };
    grid.appendChild(b);
  });
  document.getElementById('back').onclick=function(){ step2.classList.add('hide'); step1.classList.remove('hide'); };
  async function submit(){
    err.textContent=''; go.disabled=true; go.textContent='Checking…';
    try{
      var r=await fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:who,pin:pin.value})});
      if(r.ok){ location.replace('/'); return; }
      err.textContent='Incorrect PIN.';
    }catch(e){ err.textContent='Something went wrong. Try again.'; }
    go.disabled=false; go.textContent='Sign in'; pin.value=''; pin.focus();
  }
  go.onclick=submit;
  pin.addEventListener('keydown',function(e){ if(e.key==='Enter') submit(); });
</script>
</body></html>`;

const APP_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exor Pull Sheets</title>
<style>
  :root{ --ink:#1a1a1a; --mut:#7a7a7a; --line:#e7e7e7; --alt:#fafafa; --accent:#c2371b;
         --foil:#6a3bd0; --holo:#0a8aa6; --ok:#1a8f4a; --bg:#f3f3f1; }
  *{box-sizing:border-box; -webkit-tap-highlight-color:transparent}
  body{margin:0; background:var(--bg); color:var(--ink);
       font:15px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .top{position:sticky; top:0; z-index:5; background:#fff; border-bottom:2px solid var(--accent);
       display:flex; align-items:center; gap:10px; padding:10px 14px}
  .top h1{font-size:17px; font-weight:800; margin:0; letter-spacing:-.02em} .top .dot{color:var(--accent)}
  .logo{display:flex; align-items:center} .logo img{height:60px; width:auto; display:block}
  .listbtn{font-size:13px; font-weight:700; color:var(--ink); text-decoration:none; border:1px solid var(--line);
           background:#fff; border-radius:20px; padding:7px 14px; white-space:nowrap}
  .listbtn:active{background:#f3f3f1}
  .opills{display:flex; flex-wrap:wrap; gap:8px; margin-top:8px}
  .opill{display:flex; flex-direction:column; align-items:flex-start; gap:1px; min-height:46px; justify-content:center;
         border:1px solid #f0d4ac; background:#fff6f0; border-radius:24px; padding:7px 16px; cursor:pointer; text-align:left}
  .opill b{font-size:15px; color:var(--accent); font-weight:800}
  .opill span{font-size:11px; color:var(--mut)}
  .opill .opp{font-weight:700; color:#555}
  .swp{font-weight:700; color:var(--mut); font-size:11px}
  .fillall{display:block; width:100%; margin:0 0 12px; font-weight:700; color:var(--ok);
           border:1px dashed #bfe0cd; background:#f4faf7; border-radius:10px; padding:11px}
  .fillall:active{background:#e7f6ee}
  .opill.packed{border-color:#cfe9d8; background:#f4faf7} .opill.packed b{color:var(--ok)}
  .opill.on{box-shadow:0 0 0 2px var(--accent) inset; border-color:var(--accent)}
  .top .sp{flex:1}
  .who{font-size:13px; color:var(--mut)} .who b{color:var(--ink)}
  button{font:inherit; cursor:pointer; border:1px solid var(--line); background:#fff; border-radius:9px; padding:8px 14px}
  button.primary{background:var(--ink); color:#fff; border-color:var(--ink); font-weight:600}
  button.accent{background:var(--accent); color:#fff; border-color:var(--accent); font-weight:600}
  .wrap{max-width:900px; margin:0 auto; padding:14px}
  /* list */
  .job{display:block; background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px;
       margin-bottom:10px; text-decoration:none; color:inherit}
  .job .r1{display:flex; align-items:baseline; gap:10px} .job .id{font-weight:800}
  .badge{font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; padding:2px 8px; border-radius:20px}
  .b-open{background:#fdeee9; color:var(--accent)} .b-complete{background:#e7f6ee; color:var(--ok)}
  .b-pack{background:#fff3df; color:#b8780f}
  .b-quar{background:#fdeee9; color:var(--accent); border:1px solid #f3c9bd}
  .job .meta{color:var(--mut); font-size:13px; margin-top:4px}
  .bar{height:6px; background:#eee; border-radius:4px; margin-top:10px; overflow:hidden}
  .bar i{display:block; height:100%; background:var(--accent)}
  .bar i.done{background:var(--ok)}
  .bar i.pack{background:#e0a23a}
  .barrow{display:flex; align-items:center; gap:8px; margin-top:8px}
  .barrow .bar{flex:1; margin-top:0}
  .blab{font-size:10px; font-weight:800; letter-spacing:.04em; color:var(--mut); width:30px; text-transform:uppercase}
  .tabs{display:flex; gap:8px; margin-bottom:14px}
  .tab{padding:7px 15px; border:1px solid var(--line); border-radius:20px; text-decoration:none;
       color:var(--mut); font-weight:700; font-size:13px; background:#fff}
  .tab.on{background:var(--ink); color:#fff; border-color:var(--ink)}
  .archbtn{border-color:var(--line); color:#555}
  .breathe{border-color:#cfe3dd; color:#2f7a68; background:#f4faf8; font-weight:600}
  .search{display:flex; gap:8px; margin-bottom:12px}
  .search input{flex:1; min-width:0; border:1px solid var(--line); border-radius:9px; padding:10px 12px; font:inherit}
  .jobmain{cursor:pointer}
  .arrow{margin-left:auto; cursor:pointer; color:var(--mut); font-size:15px; padding:0 4px; user-select:none}
  .orddrop{display:flex; flex-wrap:wrap; gap:6px; padding:10px 2px 2px; border-top:1px solid var(--line); margin-top:10px}
  .ordchip{font-size:12px; font-weight:700; color:var(--accent); background:#fdeee9; border:1px solid #f3c9bd; border-radius:14px; padding:2px 10px}
  .ordchip.oc-all{color:var(--ok); background:#e7f6ee; border-color:#cfe9d8}
  .ordchip.oc-part{color:#b8780f; background:#fff3df; border-color:#f3dcae}
  .ordchip.oc-none{color:var(--accent); background:#fdeee9; border-color:#f3c9bd}
  .jtitle{font-size:19px; font-weight:800; letter-spacing:-.01em; margin:2px 0 12px}
  .oswitch{display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:0 0 12px}
  .swlabel{font-size:12px; color:var(--mut); font-weight:700; margin-right:4px}
  .lblbtn{margin-top:8px; font-size:12px; font-weight:700; padding:7px 12px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; display:block}
  .lblrow{display:flex; gap:8px; flex-wrap:wrap}
  .lblrow .lblbtn{flex:1; min-width:140px; text-align:center}
  .lblbtn.alt{background:#f6f4f1}
  .synchip{position:fixed; left:50%; transform:translateX(-50%); bottom:84px; z-index:40; background:var(--ink,#1b1a18); color:#fff; border:0; border-radius:999px; padding:10px 16px; font-size:13px; font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,.28); cursor:pointer; max-width:92vw}
  .swchip{font-size:13px; font-weight:700; padding:7px 13px; border-radius:18px; border:1px solid var(--line); background:#fff; cursor:pointer}
  .swchip b{font-weight:800}
  .swchip.on{box-shadow:0 0 0 2px var(--accent) inset; border-color:var(--accent); cursor:default}
  .swchip.packed{border-color:#cfe9d8} .swchip.packed b{color:var(--ok)}
  .refbtn{border-color:var(--line); color:#555}
  .refbtn.on{background:#eef2fb; color:#2f53b3; border-color:#cdd9f3}
  .card.refunded{background:#f5f6fb; border-color:#d3dbf0; opacity:.85}
  .card.refunded .ck{background:#2f53b3; border-color:#2f53b3; font-size:13px}
  .wrongbtn{border-color:var(--line); color:#a11}
  .wrongbtn.on{background:var(--accent); color:#fff; border-color:var(--accent)}
  .card.wrong{outline:2px solid var(--accent); outline-offset:-2px}
  .wronginfo{display:none; margin-top:8px; font-size:12px; background:#fff0f0; border:1px solid #f3c6c6; border-radius:8px; padding:8px 10px; color:#a11; line-height:1.45}
  .wronginfo .wn{color:#7a4a4a}
  .sttab{width:100%; border-collapse:collapse; font-size:13px}
  .sttab th{text-align:left; font-size:11px; color:var(--mut); text-transform:uppercase; letter-spacing:.04em; padding:6px 8px; border-bottom:1px solid var(--line)}
  .sttab td{padding:8px; border-bottom:1px solid var(--line)}
  .strow{padding:8px 0; border-bottom:1px solid var(--line)}
  .stat .sref{color:#2f53b3}
  .noteseed{font-size:11px; color:var(--mut); font-style:italic; margin-top:6px}
  .pvrow{display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); font-size:13px}
  .pvrow:last-child{border-bottom:none}
  .card.flash{animation:flash 2.2s ease}
  @keyframes flash{0%{box-shadow:none;background:#fff}15%,55%{box-shadow:0 0 0 3px var(--accent);background:#fff6f0}100%{box-shadow:none;background:#fff}}
  .code{font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; font-weight:700;
        letter-spacing:.06em; color:var(--mut); background:#f0f0ee; border-radius:6px;
        padding:2px 7px; margin-left:9px; vertical-align:2px}
  /* detail */
  .gh{font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--accent);
      border-bottom:2px solid var(--ink); padding:14px 0 5px; margin:0}
  .sh{font-size:14px; font-weight:700; padding:10px 0 4px} .sh .n{float:right; color:var(--mut); font-size:12px; font-weight:600}
  .card{display:flex; gap:10px; align-items:flex-start; background:#fff; border:1px solid var(--line);
        border-radius:10px; padding:10px; margin-bottom:7px}
  .card.done{background:#f6faf7; border-color:#cfe9d8}
  .card.short{background:#fff8f0; border-color:#f0d4ac}
  .card.short .ck{background:#e08a1e; border-color:#e08a1e; font-size:13px}
  .card.quar{border-color:var(--accent); border-left:4px solid var(--accent)}
  .stat{margin-left:8px; font-size:11px; font-weight:800; letter-spacing:.03em; vertical-align:1px}
  .stat .sneed{color:var(--mut)} .stat .sshort{color:#c47a10} .stat .sdone{color:var(--ok)}
  .ord-link{position:relative; color:var(--accent); text-decoration:none; font-weight:700}
  .ord-link .ox,.ordtag .ox{color:var(--ink); font-weight:700; margin-left:1px}
  .ord-link .tip{display:none; position:absolute; bottom:140%; left:0; z-index:30; white-space:nowrap;
       background:#1a1a1a; color:#fff; font-weight:500; font-size:12px; line-height:1.5;
       padding:8px 11px; border-radius:9px; box-shadow:0 6px 20px rgba(0,0,0,.3)}
  .ord-link:hover .tip{display:block}
  .ord-link .tip b{font-weight:800} .ord-link .tip .pickup{color:#ff8a6b; font-weight:800}
  .ord-link .tip .ship{color:#cfcfcf}
  .ck{flex:0 0 auto; width:26px; height:26px; border:2px solid #b3b3b3; border-radius:6px; margin-top:2px;
      display:flex; align-items:center; justify-content:center; font-weight:800; color:#fff}
  .card.done .ck{background:var(--ok); border-color:var(--ok)}
  .th{width:40px; height:56px; object-fit:cover; border-radius:4px; border:1px solid var(--line); flex:0 0 auto; cursor:zoom-in}
  .lightbox{position:fixed; inset:0; background:rgba(0,0,0,.75); display:flex; align-items:center;
            justify-content:center; z-index:40; cursor:zoom-out}
  .lightbox img{height:50vh; max-height:50vh; max-width:92vw; width:auto; border-radius:10px;
                box-shadow:0 12px 48px rgba(0,0,0,.55)}
  .cbody{flex:1; min-width:0}
  .cn{font-variant-numeric:tabular-nums; font-weight:700; color:#888; margin-left:8px}
  .nm{font-weight:600}
  .sub{font-size:12px; color:var(--mut); margin-top:2px}
  .mana{display:inline-flex; gap:2px; vertical-align:middle; margin-right:6px}
  .pip{display:inline-flex; align-items:center; justify-content:center; min-width:15px; height:15px; padding:0 3px;
       border-radius:50%; font-size:10px; font-weight:800; line-height:1; border:1px solid rgba(0,0,0,.18)}
  .pip-w{background:#fffbcf; color:#6b5b1e} .pip-u{background:#a9e0fb; color:#0b4a6b}
  .pip-b{background:#cbc2bf; color:#1a1a1a} .pip-r{background:#f9a98e; color:#7a1f08}
  .pip-g{background:#9bd3ae; color:#0f5128} .pip-n{background:#e6e1da; color:#444}
  .labelflash{position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:60; pointer-events:none; animation:lfin .12s ease}
  .labelflash.out{opacity:0; transition:opacity .3s ease}
  .llabel{width:300px; height:225px; background:#fff; border:2px solid var(--ink); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.32);
          padding:16px; display:flex; flex-direction:column; text-align:center; font-weight:700; color:#000}
  .laddr{flex:1; display:flex; flex-direction:column; justify-content:center; gap:2px; font-size:16px; word-break:break-word}
  .laddr .ll-nm{font-size:18px}
  .laddr .ll-pickup{font-size:17px; font-weight:900; letter-spacing:.04em; margin-bottom:2px}
  .laddr .ll-qty{font-size:14px; font-weight:900; color:var(--accent); margin-bottom:3px}
  .lord{border-top:2px solid #000; padding-top:6px; font-size:15px; letter-spacing:.04em}
  @keyframes lfin{from{transform:scale(.92); opacity:0} to{transform:scale(1); opacity:1}}
  .rar{color:#3a3a3a; font-weight:700} .sku{font-family:ui-monospace,Menlo,Consolas,monospace}
  .prc{color:#1a7f43; font-weight:800}
  .cond{font-size:12px; color:#555; margin-top:2px}
  .fin{font-size:10px; font-weight:800; letter-spacing:.04em; margin-left:4px}
  .fin-foil{color:var(--foil)} .fin-holo,.fin-rev{color:var(--holo)}
  .crow2{display:flex; gap:10px; align-items:center; margin-top:7px; flex-wrap:wrap}
  .cardords{display:flex; flex-wrap:wrap; gap:6px; align-items:center}
  .cardord{display:inline-flex; align-items:center; gap:7px; text-decoration:none; border:1px solid #f0d4ac;
           background:#fff6f0; border-radius:16px; padding:6px 13px; min-height:34px}
  .cardord:active{background:#fdeee9}
  .cardord b{color:var(--accent); font-size:14px; font-weight:800; letter-spacing:-.01em}
  .cardord .con{color:var(--mut); font-size:12px}
  .cardord .cq{color:#333; font-weight:800; font-size:12px; background:#fff; border:1px solid #f0d4ac; border-radius:10px; padding:1px 7px}
  .qty{display:flex; align-items:center; gap:6px; font-size:13px}
  .qty button{padding:2px 10px; border-radius:7px; font-weight:800}
  .qty .v{min-width:22px; text-align:center; font-weight:800; font-variant-numeric:tabular-nums}
  .ordtag{font-size:11px; color:var(--mut)}
  .note{width:100%; margin-top:7px; border:1px solid var(--line); border-radius:8px; padding:7px; font:inherit; resize:vertical}
  .ordbox{background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; margin:14px 0}
  .ordrow{display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line)}
  .ordrow:last-child{border-bottom:none}
  .ordrow .qn{flex:1} .qbtn{font-size:12px; font-weight:700; padding:6px 12px; border-radius:8px}
  .qbtn.on{background:#fdeee9; color:var(--accent); border-color:#f3c9bd}
  .foot{position:sticky; bottom:0; background:#fff; border-top:1px solid var(--line);
        display:flex; gap:10px; align-items:center; padding:10px 14px}
  .foot .sp{flex:1} .saved{font-size:12px; color:var(--mut)}
  .fhint{font-size:12px; color:var(--mut); margin-right:10px}
  /* modal */
  .modal{position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:20}
  .sheetcard{background:#fff; border-radius:14px; padding:20px; width:min(380px,92vw)}
  .sheetcard h2{margin:0 0 12px; font-size:18px}
  .staffgrid{display:grid; grid-template-columns:1fr 1fr; gap:8px}
  .staffgrid button{padding:12px}
  .empty{color:var(--mut); text-align:center; padding:40px 0}
  .gbadges{display:flex; flex-wrap:wrap; gap:5px; margin-top:8px}
  .gbadge{font-size:10px; font-weight:800; letter-spacing:.02em; padding:3px 8px; border-radius:999px; line-height:1.4; white-space:nowrap; text-transform:uppercase}
  .gbadge img{height:16px; width:auto; display:block}
  .jdel{font-size:11px; padding:3px 8px; color:var(--accent); background:#fff; border:1px solid #f0cfc7; border-radius:8px; cursor:pointer; margin-left:6px}
</style></head><body>
<div class="top">
  <a href="#/" class="logo"><img src="__LOGO__" alt="Exor Pull Sheet"></a>
  <a href="#/" class="listbtn">Pullsheet List</a>
  <span id="crumb" class="who"></span>
  <span class="sp"></span>
  <span class="who">Staff: <b id="whoName">—</b></span>
  <button id="signOut" style="padding:6px 10px; font-size:12px">Sign out</button>
  <button id="adminBtn" title="Staff &amp; settings" style="padding:6px 9px; font-size:14px; display:none">⚙</button>
</div>
<div class="wrap" id="view"></div>

<script>
const TOKEN = "__API_TOKEN__";
const STAFF = __STAFF__;
const STORE = "__STORE__";
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
let who = "__WHO__";
const IS_ADMIN = __ADMIN__;
let current = null;          // current job object
const deletedIds = new Set(); // sheets deleted this session (KV list is eventually consistent)
let refundWarned = false;     // show the "not a real refund" warning once per session
let currentOrder = null;     // when viewing a single order within a job
let pendingFlash = null;     // card-name to scroll-to/flash after navigating to an order
let addrCache = {};          // jobId|orderName -> address (prefetched for instant label flash)
let footBtn = null;

const $ = (s, r=document) => r.querySelector(s);
const el = (h) => { const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstChild; };
const esc = (s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Per-game badge styling. To use a real logo instead of the coloured pill, paste an
// image URL or data-URI into GAME_LOGOS for that key (e.g. GAME_LOGOS.pokemon = 'https://…png').
const GAME_BADGES = {
  pokemon:   { label:'Pokémon',       bg:'#ffcb05', fg:'#2a4b8d' },
  mtg:       { label:'Magic',         bg:'#1b1b1b', fg:'#f4b942' },
  yugioh:    { label:'Yu-Gi-Oh!',     bg:'#5b2d90', fg:'#ffffff' },
  lorcana:   { label:'Lorcana',       bg:'#0e6e7a', fg:'#f4d57a' },
  swu:       { label:'SW Unlimited',  bg:'#b3122b', fg:'#ffffff' },
  onepiece:  { label:'One Piece',     bg:'#d62828', fg:'#ffffff' },
  riftbound: { label:'Riftbound',     bg:'#0f766e', fg:'#ffffff' },
};
const GAME_LOGOS = {}; // optional: key -> image URL/data-URI
function gameBadgesHtml(keys){
  if(!keys || !keys.length) return '';
  const out = keys.map(k=>{
    const b = GAME_BADGES[k]; if(!b) return '';
    if(GAME_LOGOS[k]) return '<span class="gbadge" title="'+esc(b.label)+'" style="background:'+b.bg+';padding:3px 6px"><img src="'+esc(GAME_LOGOS[k])+'" alt="'+esc(b.label)+'"></span>';
    return '<span class="gbadge" style="background:'+b.bg+';color:'+b.fg+'">'+esc(b.label)+'</span>';
  }).filter(Boolean).join('');
  return out ? '<div class="gbadges">'+out+'</div>' : '';
}
function jobTitle(names){
  const o=(names||[]).filter(Boolean);
  if(!o.length) return 'Pull sheet';
  if(o.length===1) return 'Order '+o[0];
  if(o.length<=3) return o.join(', ');
  return o.slice(0,2).join(', ')+' +'+(o.length-2)+' more';
}

function setWho(){ $('#whoName').textContent = who || '—'; const ab=$('#adminBtn'); if(ab) ab.style.display = IS_ADMIN ? '' : 'none'; }
async function signOut(){ try{ await fetch('/logout',{method:'POST'}); }catch(e){} location.replace('/'); }
function pickStaff(){ /* identity now comes from login; no-op */ }
$('#signOut').onclick = signOut;

async function route(){
  const id = location.hash.replace(/^#\\/?/,'');
  if (id.startsWith('job/')) {
    const rest = id.slice(4);
    const oi = rest.indexOf('/order/');
    if (oi >= 0) return showOrder(rest.slice(0, oi), decodeURIComponent(rest.slice(oi + 7)));
    return showJob(rest);
  }
  if (id === 'history') return showList('history');
  return showList('active');
}
window.addEventListener('hashchange', route);

function ochipCls(st){ if(!st) return 'oc-none'; if(st.packed && st.t>0 && st.p>=st.t) return 'oc-all'; if(st.p>0) return 'oc-part'; return 'oc-none'; }
let listView='active', listSig='';
function jobsSig(jobs){ return (jobs||[]).map(j=>j.id+':'+j.status+':'+(j.pulled||0)+':'+(j.packed||0)+':'+(j.archived?1:0)).join('|'); }
function confirmDelete(j){
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(400px,94vw)">'
    +'<h2 style="margin:0 0 6px">Delete pull sheet #'+esc(j.id)+'?</h2>'
    +'<div style="font-size:13px;color:var(--mut);margin-bottom:14px">'+((j.orders||0))+' order(s). This permanently removes the sheet and can\u2019t be undone.</div>'
    +'<div style="font-weight:700;font-size:13px;margin-bottom:6px">Also remove these tags from the orders in Shopify:</div>'
    +'<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px"><input type="checkbox" id="rmPull" checked> Remove <b>PULLSHEET</b> tag</label>'
    +'<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px"><input type="checkbox" id="rmPack" checked> Remove <b>PACKED</b> tag</label>'
    +'<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px"><input type="checkbox" id="rmPrint" checked> Remove <b>PRINTED</b> tag</label>'
    +'<div id="delErr" style="color:var(--accent);font-size:12px;min-height:16px;margin:6px 0"></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="delCancel">Cancel</button><button id="delGo" class="primary" style="background:var(--accent)">Delete sheet</button></div>'
    +'</div></div>');
  $('#delCancel',m).onclick=()=>m.remove(); m.onclick=(e)=>{ if(e.target===m) m.remove(); };
  $('#delGo',m).onclick=async()=>{
    const tags=[]; if($('#rmPull',m).checked) tags.push('PULLSHEET'); if($('#rmPack',m).checked) tags.push('PACKED'); if($('#rmPrint',m).checked) tags.push('PRINTED');
    const err=$('#delErr',m), btn=$('#delGo',m); err.textContent=''; btn.disabled=true; btn.textContent=tags.length?'Removing tags & deleting…':'Deleting…';
    try{ const r=await fetch('/api/jobs/'+j.id+'/delete',{method:'POST',headers:H,body:JSON.stringify({removeTags:tags,employee:who})}); const res=await r.json().catch(()=>({}));
      if(r.ok || r.status===404 || /not found/i.test(res.error||'')){ deletedIds.add(j.id); m.remove(); lastSig=''; showList(listView); return; }
      err.textContent=res.error||'Delete failed.';
    }catch(e){ err.textContent='Something went wrong.'; }
    btn.disabled=false; btn.textContent='Delete sheet';
  };
  document.body.appendChild(m);
}
async function showList(view, quiet){
  view = view || 'active';
  listView = view;
  document.querySelectorAll('.foot').forEach(f=>f.remove()); footBtn=null;
  $('#crumb').textContent=''; current=null; currentOrder=null;
  const v = $('#view'); if(!quiet) v.innerHTML = '<div class="empty">Loading…</div>';
  const r = await fetch('/api/jobs', { headers:H }); const { jobs } = await r.json();
  const all = (jobs || []).filter(j => !deletedIds.has(j.id));
  listSig = jobsSig(all);
  const list = all.filter(j => view==='history' ? j.archived : !j.archived);

  v.innerHTML='';
  // search by order number → jump to its sheet
  const sb = el('<div class="search"><input id="osearch" placeholder="Search order # (e.g. 182800)" inputmode="numeric"><button id="osearchbtn">Find</button></div>');
  v.appendChild(sb);
  const doSearch=()=>{
    const q=($('#osearch').value||'').replace(/[^0-9]/g,''); if(!q) return;
    const hit=all.find(j=>(j.orderNames||[]).some(n=>String(n).replace(/[^0-9]/g,'')===q));
    if(hit) location.hash='#/job/'+hit.id;
    else { const m=$('#osearchmsg')||el('<div class="empty" id="osearchmsg"></div>'); m.textContent='No pull sheet contains order #'+q+'.'; sb.after(m); }
  };
  $('#osearchbtn',sb).onclick=doSearch;
  $('#osearch',sb).addEventListener('keydown',e=>{ if(e.key==='Enter') doSearch(); });

  // Active / History switch
  const tabs = el('<div class="tabs"></div>');
  tabs.appendChild(el('<a class="tab'+(view==='active'?' on':'')+'" href="#/">Active</a>'));
  tabs.appendChild(el('<a class="tab'+(view==='history'?' on':'')+'" href="#/history">History ('+all.filter(j=>j.archived).length+')</a>'));
  v.appendChild(tabs);

  if (!list.length){
    v.appendChild(el('<div class="empty">'+(view==='history'
      ? 'No archived pull sheets yet. Archive a finished sheet to file it here.'
      : 'No active pull sheets. Generate one from Shopify, or check History.')+'</div>'));
    return;
  }
  list.forEach(j=>{
    const pct = j.total ? Math.round((j.pulled||0)/j.total*100) : 0;
    const ords = j.orders||0, packed = j.packed||0;
    const ppct = ords ? Math.round(packed/ords*100) : 0;
    const picked = (j.status==='complete') || (j.total>0 && (j.pulled||0)>=j.total);
    const allPacked = ords>0 && packed>=ords;
    const done = picked && allPacked;
    let badge;
    if (done) badge='<span class="badge b-complete">Done ✓</span>';
    else if (picked) badge='<span class="badge b-pack">Packing '+packed+'/'+ords+'</span>';
    else badge='<span class="badge b-open">Picking '+(j.pulled||0)+'/'+(j.total||0)+'</span>';
    const d = new Date(j.createdAt);
    const card = el('<div class="job">'
      + '<div class="jobmain">'
      +   '<div class="r1"><span class="id">#'+esc(j.id)+'</span>'
      +   badge
      +   (j.quarantined?'<span class="badge b-quar">⚠ '+j.quarantined+' quarantined</span>':'')
      +   (IS_ADMIN?'<button class="jdel" title="Delete this pull sheet">Delete</button>':'')
      +   '<span class="arrow" title="Show orders">▾</span></div>'
      +   '<div class="meta">'+d.toLocaleString()+' · '+ords+' orders · '+(j.pulled||0)+'/'+(j.total||0)+' pulled · '+packed+'/'+ords+' packed'
      +   (j.short?' · <span style="color:#c47a10;font-weight:700">'+j.short+' short</span>':'')
      +   ((j.workedBy&&j.workedBy.length)?' · '+esc(j.workedBy.join(', ')):'')+'</div>'
      +   '<div class="barrow"><span class="blab">Pick</span><div class="bar"><i class="'+(picked?'done':'')+'" style="width:'+pct+'%"></i></div></div>'
      +   '<div class="barrow"><span class="blab">Pack</span><div class="bar"><i class="pack'+(allPacked?' done':'')+'" style="width:'+ppct+'%"></i></div></div>'
      +   gameBadgesHtml(j.games)
      + '</div>'
      + '<div class="orddrop" hidden>'+((j.orderStats&&j.orderStats.length)?j.orderStats.map(st=>'<span class="ordchip '+ochipCls(st)+'">'+esc(st.n)+'</span>').join(''):((j.orderNames||[]).map(n=>'<span class="ordchip">'+esc(n)+'</span>').join('')||'<span class="ordtag">no order list</span>'))+'</div>');
    $('.jobmain',card).onclick=()=>{ location.hash='#/job/'+j.id; };
    const delBtn=$('.jdel',card); if(delBtn) delBtn.onclick=(e)=>{ e.stopPropagation(); confirmDelete(j); };
    const arr=$('.arrow',card), drop=$('.orddrop',card);
    arr.onclick=(e)=>{ e.stopPropagation(); const open=drop.hasAttribute('hidden'); if(open){drop.removeAttribute('hidden'); arr.textContent='▴';} else {drop.setAttribute('hidden',''); arr.textContent='▾';} };
    drop.querySelectorAll('.ordchip').forEach((ch,ix)=>{ ch.style.cursor='pointer'; ch.onclick=(e)=>{ e.stopPropagation(); const nm=(j.orderStats&&j.orderStats[ix]&&j.orderStats[ix].n)||(j.orderNames||[])[ix]; if(nm) location.hash='#/job/'+j.id+'/order/'+encodeURIComponent(nm); }; });
    v.appendChild(card);
  });
}

async function showJob(id){
  pickStaff();
  currentOrder=null;
  const v=$('#view'); v.innerHTML='<div class="empty">Loading…</div>';
  const r = await fetch('/api/jobs/'+id, { headers:H }); current = await r.json();
  if (current.error){ v.innerHTML='<div class="empty">'+esc(current.error)+'</div>'; return; }
  $('#crumb').innerHTML='';
  render();
}

/* ─────────────────── Per-order packing view ─────────────────── */
function ostate(name){ const s=current.state; s.orders=s.orders||{}; if(!s.orders[name]) s.orders[name]={found:{},notes:{},refunded:{},note:'',status:'open',workedBy:[],lastSavedBy:'',lastSavedAt:''}; const os=s.orders[name]; if(!os.picks)os.picks={}; if(!os.mistakes)os.mistakes={}; return os; }
function fmtDur(ms){ if(ms==null) return '—'; const s=Math.round(ms/1000); if(s<60) return s+'s'; const m=Math.round(s/60); if(m<60) return m+' min'; const h=Math.floor(m/60); return h+'h '+(m%60)+'m'; }
function jobCardsForOrder(name){ const out=[]; jobCards().forEach(c=>{ const oo=(c.orders||[]).find(o=>o.name===name); if(oo) out.push({card:c, need:oo.qty}); }); return out; }
function orderRemainingLocal(name){ const os=ostate(name); const q=current.state.quarantined||{}; return jobCardsForOrder(name).filter(x=>!(((+os.found[x.card.cid]||0)>=x.need)||os.refunded[x.card.cid]||q[x.card.cid])).length; }
function orderQuarantinedCards(name){ const q=current.state.quarantined||{}; return jobCardsForOrder(name).filter(x=>q[x.card.cid]).map(x=>x.card); }
function orderProgress(name){ const os=ostate(name); let found=0,refunded=0,total=0; jobCardsForOrder(name).forEach(x=>{ total+=x.need; if(os.refunded[x.card.cid]) refunded+=x.need; else found+=Math.min(+os.found[x.card.cid]||0, x.need); }); return {pulled:found+refunded, found, refunded, total}; }
function ordersBoxEl(currentName){
  const j=current, s=j.state;
  const totalItems=jobCards().reduce((n,c)=>n+(+c.qty||0),0);
  const ob=el('<div class="ordbox"><div style="font-weight:700;margin-bottom:2px">Orders ('+j.orders.length+') · '+totalItems+' item'+(totalItems===1?'':'s')+'</div>'
    +'<div class="opills">'+j.orders.map(o=>{ const os=(s.orders&&s.orders[o.name])||{}; const pr=orderProgress(o.name); const complete=pr.total>0 && pr.pulled>=pr.total; const packed=os.status==='packed' && complete; const cur=o.name===currentName;
        return '<button class="opill'+(packed?' packed':'')+(cur?' on':'')+'" data-o="'+esc(o.name)+'"><b>'+esc(o.name)+(packed?' ✓':'')+'</b>'+(o.customer?'<span>'+esc(o.customer)+'</span>':'')+'<span class="opp">'+pr.pulled+'/'+pr.total+' placed'+(pr.refunded?' · '+pr.refunded+' refunded':'')+'</span></button>'; }).join('')+'</div>'
    +'<div class="lblrow"><button id="alllbl" class="lblbtn">🏷 Print all labels</button><button id="allpaper" class="lblbtn alt">📄 Print on paper</button><button id="eslflash" class="lblbtn" style="color:var(--accent);border-color:#f0cfc7">⚡ Flash tags</button></div></div>');
  ob.querySelectorAll('.opill').forEach(b=>{ const nm=b.getAttribute('data-o'); b.onclick=()=>{ if(nm===currentName) return; if(currentName) flushSaves(); location.hash='#/job/'+j.id+'/order/'+encodeURIComponent(nm); }; });
  const ab=$('#alllbl',ob); if(ab) ab.onclick=()=>printAllLabels(ab);
  const ap=$('#allpaper',ob); if(ap) ap.onclick=()=>printAllLabels(ap,true);
  const ef=$('#eslflash',ob); if(ef) ef.onclick=async()=>{ const old=ef.textContent; ef.disabled=true; ef.textContent='Flashing\u2026';
    try{ const r=await fetch('/api/jobs/'+j.id+'/flash',{method:'POST',headers:H,body:JSON.stringify({order:currentName||null,employee:who})}); const res=await r.json();
      if(res.error) alert('Flash failed: '+res.error);
      else{ const n=(res.flashed||[]).length, miss=(res.no_tag||[]).length;
        alert(n?('Flashing '+n+' shelf tag'+(n===1?'':'s')+' pink for 1 minute'+(miss?' ('+miss+' item'+(miss===1?'':'s')+' have no tag)':'')+' \u2014 follow the blinking lights.'):'None of these items have shelf tags.'); }
    }catch(e){ alert('Flash request failed.'); }
    ef.disabled=false; ef.textContent=old; };
  return ob;
}
function refreshOrdersBox(){ if(!currentOrder) return; const pills=document.querySelector('#view .ordbox .opills'); const box=pills&&pills.closest('.ordbox'); if(box) box.replaceWith(ordersBoxEl(currentOrder)); }
function oUnpackIfNeeded(name){ const os=ostate(name); if(os.status==='packed' && orderRemainingLocal(name)>0){ os.status='open'; refreshOrderFoot(); refreshOrdersBox(); qfetch('/pack',{order:name,packed:false}); } }

async function showOrder(jobId, orderName){
  pickStaff();
  document.querySelectorAll('.foot').forEach(f=>f.remove()); footBtn=null;
  const v=$('#view'); v.innerHTML='<div class="empty">Loading…</div>';
  const r=await fetch('/api/jobs/'+jobId,{headers:H}); current=await r.json();
  if(current.error){ v.innerHTML='<div class="empty">'+esc(current.error)+'</div>'; return; }
  currentOrder=orderName;
  $('#crumb').innerHTML='<a href="#/job/'+esc(current.id)+'" class="listbtn">← Sheet #'+esc(current.id)+'</a>';
  renderOrder();
  // prefetch shipping address so the on-check label flash is instant
  const ak=jobId+'|'+orderName;
  if(!addrCache[ak]) fetch('/api/jobs/'+jobId+'/address',{method:'POST',headers:H,body:JSON.stringify({order:orderName})}).then(r=>r.json()).then(a=>{ addrCache[ak]=a; }).catch(()=>{});
}

function renderOrder(){
  const j=current, name=currentOrder, os=ostate(name), v=$('#view'); v.innerHTML='';
  const oinfo=(j.orders||[]).find(o=>o.name===name)||{name};
  v.appendChild(el('<h1 class="jtitle">Order '+esc(name)+'<span class="code">sheet #'+esc(j.id)+'</span></h1>'));

  // same Orders box as the sheet view (this order ringed) — consistent top on every page
  v.appendChild(ordersBoxEl(name));

  const num=gidNum(oinfo.gid); const shopUrl=(num&&STORE)?('https://admin.shopify.com/store/'+STORE+'/orders/'+num):'';
  v.appendChild(el('<div class="ordbox"><div style="font-size:13px;color:#555">'
    +'<b>'+esc(oinfo.customer||name)+'</b>'+(oinfo.date?' · '+new Date(oinfo.date).toLocaleString():'')
    +' · <span style="'+(oinfo.local?'color:var(--accent);font-weight:800':'')+'">'+(oinfo.local?'LOCAL PICKUP':esc(oinfo.shipping||'Shipping'))+'</span>'
    +(oinfo.total!=null?' · '+money(oinfo.total,oinfo.currency):'')+(oinfo.itemQty!=null?' · '+oinfo.itemQty+' items':'')
    +'</div>'+(shopUrl?'<a class="ord-link" href="'+shopUrl+'" target="_blank" rel="noopener" style="font-size:12px;margin-top:4px;display:inline-block">Open in Shopify ↗</a>':'')
    +'<button id="lblbtn" class="lblbtn">🏷 Print label</button></div>'));
  const lb=$('#lblbtn',$('#view')); if(lb) lb.onclick=()=>printLabelFor(name, oinfo);

  const cs=el('<div class="search"><input id="csearch" placeholder="Find a card across this sheet\u2019s orders"><button id="csearchbtn">Find</button></div>');
  v.appendChild(cs);
  $('#csearchbtn',cs).onclick=()=>cardSearch($('#csearch',cs).value);
  $('#csearch',cs).addEventListener('keydown',e=>{ if(e.key==='Enter') cardSearch(e.target.value); });

  const onote=el('<textarea class="note" placeholder="Order notes\u2026">'+esc(os.note||'')+'</textarea>');
  onote.oninput=()=>{ os.note=onote.value; debounce('onote-'+name,600,()=>oPatch({order:name,op:'orderNote',value:os.note})); };
  v.appendChild(onote);

  const fillBtn=el('<button class="fillall">✓ Mark all found</button>');
  fillBtn.onclick=()=>confirmModal('Mark <b>all items</b> in Order '+esc(name)+' as found?<div style="color:var(--mut);font-size:13px;margin-top:6px">Sets every non-refunded card to its full quantity. Refunded cards are left alone.</div>','Yes, mark all found',()=>oFillAll(name));
  v.appendChild(fillBtn);

  let any=false;
  (j.games||[]).forEach(g=>{
    const groups=(g.sets||[]).map(st=>({st, cards:(st.cards||[]).filter(c=>(c.orders||[]).some(o=>o.name===name))})).filter(x=>x.cards.length);
    if(!groups.length) return;
    groups.sort((a,b)=>(a.st.setName||'').localeCompare(b.st.setName||''));
    v.appendChild(el('<h2 class="gh">'+esc(g.game||'Singles')+'</h2>'));
    groups.forEach(({st,cards})=>{
      v.appendChild(el('<div class="sh">'+esc(st.setName)+'<span class="n">'+cards.length+' card'+(cards.length>1?'s':'')+'</span></div>'));
      cards.forEach(c=>{ const need=((c.orders||[]).find(o=>o.name===name)||{}).qty||c.qty; v.appendChild(orderCardEl(c, need, name, g.game)); any=true; });
    });
  });
  const sealedForOrder=(j.sealed||[]).filter(c=>(c.orders||[]).some(o=>o.name===name));
  if(sealedForOrder.length){ v.appendChild(el('<h2 class="gh">Sealed &amp; Accessories</h2>'));
    sealedForOrder.forEach(c=>{ const need=((c.orders||[]).find(o=>o.name===name)||{}).qty||c.qty; v.appendChild(orderCardEl(c, need, name)); any=true; }); }
  if(!any) v.appendChild(el('<div class="empty">No items for this order.</div>'));

  const foot=el('<div class="foot"><span class="saved" id="saved"></span><span class="sp"></span><span class="fhint" id="fhint"></span></div>');
  const br=el('<button class="breathe">Breathe</button>');
  br.onclick=()=>{ br.textContent='Saved ✓'; flushSaves(); setTimeout(()=>{ location.hash='#/job/'+j.id; },250); };
  footBtn=el('<button>Finalize · PACKED</button>');
  footBtn.onclick=()=>{
    if(os.status==='packed'){ oPack(name, false); return; }
    if(orderRemainingLocal(name)>0) return;
    if(os.startedBy && os.startedBy===who){ alert('Four-eye check: this order was picked by '+os.startedBy+'. A different person must sign in to verify and pack it.'); return; }
    const qc=orderQuarantinedCards(name);
    if(qc.length){ quarantinePackWarning(name, qc); return; }
    oPack(name, true);
  };
  foot.appendChild(br); foot.appendChild(footBtn); document.body.appendChild(foot);
  const foots=document.querySelectorAll('.foot'); if(foots.length>1) foots[0].remove();
  refreshOrderFoot(); updateSaved();
  if(pendingFlash){ const q=pendingFlash; pendingFlash=null; setTimeout(()=>flashCard(q), 80); }
}

function refreshOrderFoot(){ if(!footBtn||!currentOrder) return; const os=ostate(currentOrder); const hint=document.getElementById('fhint');
  if(os.status==='packed'){ footBtn.textContent='Unpack'; footBtn.disabled=false; footBtn.className=''; footBtn.style.opacity='1'; if(hint) hint.textContent='Packed ✓ by '+esc(os.packedBy||os.lastSavedBy||'—'); return; }
  const rem=orderRemainingLocal(currentOrder);
  const sameEye = os.startedBy && who && os.startedBy===who;
  if(rem<=0 && sameEye){ footBtn.textContent='Finalize · PACKED'; footBtn.disabled=true; footBtn.className=''; footBtn.style.opacity='.5'; if(hint) hint.innerHTML='4-eye: picked by '+esc(os.startedBy)+' — needs a different person to verify'; return; }
  footBtn.textContent='Finalize · PACKED'; footBtn.disabled=rem>0; footBtn.className=rem>0?'':'primary'; footBtn.style.opacity=rem>0?'.5':'1';
  const qn = orderQuarantinedCards(currentOrder).length;
  if(hint) hint.textContent= rem>0?(rem+' item'+(rem>1?'s':'')+' left'):(qn?('ready · '+qn+' in quarantine'):'ready to verify & pack'); }

function orderCardEl(c, need, name, game){
  const os=ostate(name); const finTag=finOf(c.cond); const showCn=c.collector && !isPokGame(game);
  const node=el('<div class="card">'
    +'<div class="ck"></div>'
    +(c.img?'<img class="th" src="'+esc(c.img)+'">':'')
    +'<div class="cbody">'
    + '<div><span class="nm">'+esc(c.card)+'</span>'+(showCn?'<span class="cn">'+esc(c.collector)+'</span>':'')+'<span class="stat"></span></div>'
    + cardSub(c)
    + '<div class="cond">'+esc(condBase(c.cond))+(finTag?'<span class="fin fin-'+finTag.cls+'">'+finTag.t+'</span>':'')+'</div>'
    +'</div></div>');
  const ck=$('.ck',node), stat=$('.stat',node), thumb=$('.th',node);
  if(thumb) thumb.onclick=(e)=>{ e.stopPropagation(); openImg(c.img); };
  const getF=()=>{ const f=+os.found[c.cid]; return isNaN(f)?0:f; };
  let vEl;
  function paint(){ const f=getF(), ref=!!os.refunded[c.cid];
    node.classList.toggle('done', !ref && f>=need); node.classList.toggle('short', !ref && f>0 && f<need); node.classList.toggle('refunded', ref);
    ck.textContent= ref?'↩':(f>=need?'✓':(f>0?f:''));
    if(ref) stat.innerHTML='<span class="sref">REFUNDED</span>';
    else if(need>1) stat.innerHTML = f>=need?'<span class="sdone">all '+need+'</span>':(f>0?'<span class="sshort">SHORT '+f+'/'+need+'</span>':'<span class="sneed">need '+need+'</span>');
    else stat.innerHTML= f>=need?'<span class="sdone">found</span>':'';
    if(vEl) vEl.textContent=f; }
  const setF=(nv)=>{ nv=Math.max(0,Math.min(need,nv)); os.found[c.cid]=nv; paint(); refreshOrderFoot(); refreshOrdersBox(); oUnpackIfNeeded(name); debounce('of-'+name+c.cid,350,()=>oPatch({order:name,op:'found',cid:c.cid,value:os.found[c.cid]})); };
  const toggle=()=>{ if(os.refunded[c.cid]) return; const willFind=getF()<need; setF(willFind?need:0); if(willFind) flashLabel(name); };
  ck.onclick=toggle; $('.nm',node).onclick=toggle;
  const r2=el('<div class="crow2"></div>');
  const qty=el('<div class="qty"><button>−</button><span class="v"></span><button>+</button></div>');
  vEl=$('.v',qty); const mp=qty.querySelectorAll('button'); mp[0].onclick=()=>setF(getF()-1); mp[1].onclick=()=>setF(getF()+1);
  const sheetNote=(current.state.cardNotes||{})[c.cid]||'';
  const hasOv=Object.prototype.hasOwnProperty.call(os.notes, c.cid);
  const effNote=hasOv?(os.notes[c.cid]||''):sheetNote;
  const noteBtn=el('<button style="font-size:12px;padding:4px 10px">'+(effNote?'note ✎':'+ note')+'</button>');
  const refBtn=el('<button class="refbtn'+(os.refunded[c.cid]?' on':'')+'" style="font-size:12px;padding:4px 10px">'+(os.refunded[c.cid]?'↩ Refunded':'Refund')+'</button>');
  refBtn.onclick=()=>{ const nx=!os.refunded[c.cid];
    const apply=()=>{ os.refunded[c.cid]=nx; refBtn.className='refbtn'+(nx?' on':''); refBtn.style.fontSize='12px'; refBtn.style.padding='4px 10px'; refBtn.textContent=nx?'↩ Refunded':'Refund'; paint(); refreshOrderFoot(); refreshOrdersBox(); oUnpackIfNeeded(name); oPatch({order:name,op:'refund',cid:c.cid,value:nx}); };
    if(nx && !refundWarned){ confirmModal('Marking this card <b>Refunded</b> only tracks it on the pull sheet so the order can be packed without it.<div style="color:var(--accent);font-weight:700;margin-top:8px">It does NOT refund the customer in Shopify.</div><div style="color:var(--mut);font-size:13px;margin-top:6px">You still have to issue the refund manually in Shopify.</div>','Got it — mark refunded',()=>{ refundWarned=true; apply(); }); }
    else apply();
  };
  const wrongBtn=el('<button class="wrongbtn" style="font-size:12px;padding:4px 10px">⚠ Wrong?</button>');
  // Wrong-card reports never show on the order page (no blame on the floor). They appear
  // only in the manager Stats & accountability panel. The button just files a report.
  function renderWrong(){ node.classList.remove('wrong'); }
  wrongBtn.onclick=()=>{
    if(wrongBtn.disabled) return;
    const note=prompt('Report WRONG CARD for "'+(c.card||'')+'".\\nWhat was wrong? (optional)','');
    if(note===null) return;
    mPatch({order:name,cid:c.cid,on:true,note:note});
    wrongBtn.textContent='Reported ✓'; wrongBtn.disabled=true; setTimeout(()=>{ wrongBtn.disabled=false; wrongBtn.textContent='⚠ Wrong?'; },1600);
  };
  r2.appendChild(qty); r2.appendChild(noteBtn); r2.appendChild(refBtn); r2.appendChild(wrongBtn); $('.cbody',node).appendChild(r2);
  renderWrong();
  const attachNote=(initial, inherited)=>{
    const wrap=el('<div class="cnotewrap"></div>');
    if(inherited) wrap.appendChild(el('<div class="noteseed">from pull sheet — edit to make order-specific</div>'));
    const ta=el('<textarea class="note cnote" placeholder="Note\u2026">'+esc(initial||'')+'</textarea>');
    ta.oninput=()=>{ os.notes[c.cid]=ta.value; noteBtn.textContent=ta.value?'note ✎':'+ note'; const sd=wrap.querySelector('.noteseed'); if(sd) sd.remove(); debounce('on-'+name+c.cid,600,()=>oPatch({order:name,op:'note',cid:c.cid,value:os.notes[c.cid]})); };
    wrap.appendChild(ta); $('.cbody',node).appendChild(wrap); return ta;
  };
  noteBtn.onclick=()=>{ const ex=$('.cnote',node); if(ex){ ex.focus(); return; } attachNote(effNote, !hasOv && !!sheetNote).focus(); };
  if(effNote){ attachNote(effNote, !hasOv && !!sheetNote); }
  paint(); return node;
}

async function oPatch(body){ if(!current) return {}; const id=current.id; updateSaved('saving…');
  return queueSend(async ()=>{
    try{ const r=await fetch('/api/jobs/'+id+'/opatch',{method:'POST',headers:H,body:JSON.stringify(Object.assign({employee:who},body))}); const j=await r.json();
      if(current && current.id===id && j&&j.lastSavedAt){ const os=ostate(body.order); os.lastSavedAt=j.lastSavedAt; os.lastSavedBy=j.lastSavedBy; } updateSaved(); return j||{};
    }catch(e){ updateSaved('save failed'); return {error:String(e.message||e)}; }
  });
}

async function mPatch(body){ if(!current) return {}; const id=current.id; updateSaved('saving…');
  return queueSend(async ()=>{
    try{ const r=await fetch('/api/jobs/'+id+'/mistake',{method:'POST',headers:H,body:JSON.stringify(Object.assign({employee:who},body))}); const j=await r.json(); updateSaved(); return j||{};
    }catch(e){ updateSaved('save failed'); return {}; }
  });
}

function confirmModal(msg, okLabel, onOk){
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(380px,92vw)"><div style="font-size:15px;line-height:1.4;margin-bottom:16px">'+msg+'</div><div style="display:flex;gap:8px;justify-content:flex-end"><button id="cm-no">Cancel</button><button id="cm-yes" class="primary">'+esc(okLabel)+'</button></div></div></div>');
  $('#cm-no',m).onclick=()=>m.remove();
  $('#cm-yes',m).onclick=()=>{ m.remove(); onOk(); };
  m.onclick=(e)=>{ if(e.target===m) m.remove(); };
  document.body.appendChild(m);
}
async function oFillAll(name){
  flushSaves();
  updateSaved('saving…');
  const j = await qfetch('/ofill',{order:name});
  if(j.error){ alert(j.error); return; }
  const os=ostate(name); jobCardsForOrder(name).forEach(x=>{ if(!os.refunded[x.card.cid]) os.found[x.card.cid]=x.need; }); renderOrder();
}

function quarantinePackWarning(name, qc){
  const list=qc.map(c=>'<li>'+esc(c.card||c.cid)+(c.collector?' <span style="color:var(--mut)">#'+esc(c.collector)+'</span>':'')+'</li>').join('');
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(420px,94vw)">'
    +'<h2 style="margin:0 0 6px">⚠ '+qc.length+' card'+(qc.length>1?'s':'')+' in quarantine</h2>'
    +'<div style="font-size:13px;color:var(--mut);margin-bottom:10px">This order has quarantined card'+(qc.length>1?'s':'')+' that won\u2019t be in the package:</div>'
    +'<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;max-height:160px;overflow:auto">'+list+'</ul>'
    +'<div style="display:flex;flex-direction:column;gap:8px">'
    +'<button id="qref" class="primary">Mark '+(qc.length>1?'them':'it')+' refunded &amp; pack</button>'
    +'<button id="qgo">Pack anyway</button>'
    +'<button id="qcancel" style="background:none;border:0;color:var(--mut);padding:6px">Cancel</button>'
    +'</div></div></div>');
  m.onclick=(e)=>{ if(e.target===m) m.remove(); };
  $('#qcancel',m).onclick=()=>m.remove();
  $('#qgo',m).onclick=()=>{ m.remove(); oPack(name,true); };
  $('#qref',m).onclick=()=>{ m.remove();
    const os=ostate(name);
    qc.forEach(c=>{ if(!os.refunded[c.cid]){ os.refunded[c.cid]=true; oPatch({order:name,op:'refund',cid:c.cid,value:true}); } });
    refreshOrdersBox();
    oPack(name,true);
  };
  document.body.appendChild(m);
}
async function oPack(name, packed, override){
  flushSaves();
  updateSaved('saving…');
  const id=current.id;
  const j = await queueSend(async ()=>{
    try{ const r=await fetch('/api/jobs/'+id+'/pack',{method:'POST',headers:H,body:JSON.stringify({order:name,packed,employee:who,override:!!override})}); return await r.json(); }
    catch(e){ return {error:'Failed: '+(e.message||e)}; }
  });
  if(j.error){
    if(j.fourEye && j.canOverride){ confirmModal('You picked this order. Four-eye policy normally needs a <b>different</b> person to verify and pack it.<div style="color:var(--mut);font-size:13px;margin-top:6px">Override as manager and pack anyway? The override is recorded.</div>','Override &amp; pack',()=>oPack(name,packed,true)); return; }
    alert(j.error); return;
  }
  ostate(name).status=packed?'packed':'open'; renderOrder();
}

function orderPreview(name){
  const os=ostate(name); const list=jobCardsForOrder(name).sort((a,b)=>a.card.card.localeCompare(b.card.card));
  const rows=list.map(x=>{ const f=+os.found[x.card.cid]||0; const ref=!!os.refunded[x.card.cid];
    const st= ref?'<span class="sref">REFUNDED</span>':(f>=x.need?'<span class="sdone">✓</span>':(f>0?'<span class="sshort">'+f+'/'+x.need+'</span>':'<span class="sneed">'+x.need+'</span>'));
    return '<div class="pvrow"><span>'+(x.card.collector?'<b>'+esc(x.card.collector)+'</b> ':'')+esc(x.card.card)+'</span>'+st+'</div>'; }).join('');
  const oinfo=(current.orders||[]).find(o=>o.name===name)||{name};
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(460px,94vw);max-height:80vh;display:flex;flex-direction:column">'
    +'<h2 style="margin:0 0 4px">Order '+esc(name)+(os.status==='packed'?' · <span style="color:var(--ok)">PACKED</span>':'')+'</h2>'
    +'<div style="font-size:12px;color:#666;margin-bottom:10px">'+esc(oinfo.customer||'')+(oinfo.local?' · <span style="color:var(--accent);font-weight:800">LOCAL PICKUP</span>':'')+'</div>'
    +'<div class="pvlist" style="overflow:auto;flex:1">'+(rows||'<div class="empty">No items</div>')+'</div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button id="pvclose">Close</button><button id="pvopen" class="primary">Open this order</button></div>'
    +'</div></div>');
  $('#pvclose',m).onclick=()=>m.remove();
  $('#pvopen',m).onclick=()=>{ m.remove(); flushSaves(); location.hash='#/job/'+current.id+'/order/'+encodeURIComponent(name); };
  m.onclick=(e)=>{ if(e.target===m) m.remove(); };
  document.body.appendChild(m);
}

function cardSearch(qstr){
  const q=String(qstr||'').trim().toLowerCase(); if(!q) return;
  const matches=(current.orders||[]).map(o=>o.name).filter(n=>jobCardsForOrder(n).some(x=>x.card.card.toLowerCase().includes(q)));
  if(!matches.length){ alert('No card matching “'+qstr+'” in this sheet.'); return; }
  if(matches.includes(currentOrder)){ flashCard(q); return; }
  pendingFlash=q; flushSaves(); location.hash='#/job/'+current.id+'/order/'+encodeURIComponent(matches[0]);
}
function flashCard(q){ q=String(q||'').toLowerCase(); const cards=[...document.querySelectorAll('#view .card')]; const hit=cards.find(n=>{ const nm=n.querySelector('.nm'); return nm && nm.textContent.toLowerCase().includes(q); }); if(hit){ hit.scrollIntoView({behavior:'smooth',block:'center'}); hit.classList.add('flash'); setTimeout(()=>hit.classList.remove('flash'),2200); } }

function openStats(){
  let days='30';
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(620px,96vw);max-height:90vh;overflow:auto">'
    +'<h2 style="margin:0 0 4px">Staff stats &amp; accountability</h2>'
    +'<div style="font-size:12px;color:var(--mut);margin-bottom:12px">Picks, packs, total &amp; average time per order, and wrong-card reports per person.</div>'
    +'<div id="stRange" style="display:flex;gap:6px;margin-bottom:14px"></div>'
    +'<div id="stBody">Loading…</div>'
    +'<div style="text-align:right;margin-top:16px"><button id="stClose">Close</button></div>'
    +'</div></div>');
  $('#stClose',m).onclick=()=>m.remove(); m.onclick=(e)=>{ if(e.target===m) m.remove(); };
  const rangeWrap=$('#stRange',m); const ranges=[['7','7 days'],['30','30 days'],['90','90 days'],['all','All time']];
  const rbtns={};
  ranges.forEach(([v,lab])=>{ const b=el('<button style="font-size:12px;padding:6px 10px">'+lab+'</button>'); rbtns[v]=b; b.onclick=()=>{ days=v; paintRange(); load(); }; rangeWrap.appendChild(b); });
  function paintRange(){ Object.keys(rbtns).forEach(k=>{ rbtns[k].className = (k===days)?'primary':''; }); }
  async function load(){
    const body=$('#stBody',m); body.innerHTML='Loading…';
    try{
      const r=await fetch('/api/stats?days='+days,{headers:H});
      if(!r.ok){ const j=await r.json().catch(()=>({})); body.innerHTML='<div class="empty">'+esc(j.error||'Could not load stats.')+'</div>'; return; }
      const {people,recent}=await r.json();
      let h='';
      if(!people||!people.length){ h+='<div class="empty">No activity in this period yet.</div>'; }
      else{
        h+='<table class="sttab"><thead><tr><th>Staff</th><th>Cards picked</th><th>Orders packed</th><th>Total time</th><th>Avg / order</th><th>Wrong cards</th></tr></thead><tbody>';
        people.forEach(p=>{ h+='<tr><td><b>'+esc(p.name)+'</b></td><td>'+p.picks+'</td><td>'+p.packed+'</td><td>'+(p.totalPickMs?fmtDur(p.totalPickMs):'—')+'</td><td>'+(p.avgPickMs!=null?fmtDur(p.avgPickMs):'—')+'</td><td>'+(p.mistakes?('<span style="color:var(--accent);font-weight:800">'+p.mistakes+'</span>'):'0')+'</td></tr>'; });
        h+='</tbody></table>';
      }
      h+='<div style="font-weight:700;margin:18px 0 8px">Wrong cards reported</div>';
      if(!recent||!recent.length){ h+='<div class="empty">No wrong-card reports in this period.</div>'; }
      else{
        recent.forEach(x=>{ const pat=x.pickedAt?new Date(x.pickedAt).toLocaleString():'unknown'; const rat=x.reportedAt?new Date(x.reportedAt).toLocaleString():'';
          h+='<div class="strow" data-job="'+esc(x.jobId)+'" data-order="'+esc(x.order)+'" data-cid="'+esc(x.cid||'')+'">'
            +'<div style="display:flex;justify-content:space-between;gap:8px"><div><b>'+esc(x.card)+'</b> · order '+esc(x.order)+' <span style="color:var(--mut)">(sheet #'+esc(x.jobId)+')</span></div>'
            +'<button class="stdismiss" style="font-size:11px;padding:3px 8px;white-space:nowrap">Dismiss</button></div>'
            +'<div style="font-size:12px;color:#a11;margin-top:2px">Picked by <b>'+esc(x.by)+'</b> · '+esc(pat)+(x.durationMs!=null?' · pick took '+fmtDur(x.durationMs):'')+'</div>'
            +'<div style="font-size:11px;color:var(--mut);margin-top:2px">Flagged by '+esc(x.reportedBy||'—')+(rat?' · '+esc(rat):'')+(x.note?' · \u201c'+esc(x.note)+'\u201d':'')+'</div></div>';
        });
      }
      body.innerHTML=h;
      body.querySelectorAll('.stdismiss').forEach(b=>{ b.onclick=async()=>{ const row=b.closest('.strow'); const jid=row.getAttribute('data-job'), ord=row.getAttribute('data-order'), cid=row.getAttribute('data-cid');
        if(!confirm('Dismiss this wrong-card report? It will be removed from accountability.')) return;
        b.disabled=true; b.textContent='…';
        try{ await fetch('/api/jobs/'+jid+'/mistake',{method:'POST',headers:H,body:JSON.stringify({order:ord,cid,on:false,employee:who})}); row.style.display='none'; }
        catch(e){ b.disabled=false; b.textContent='Dismiss'; }
      }; });
    }catch(e){ body.innerHTML='<div class="empty">Something went wrong.</div>'; }
  }
  document.body.appendChild(m); paintRange(); load();
}

function openAdmin(){
  const m=el('<div class="modal"><div class="sheetcard" style="width:min(440px,95vw);max-height:88vh;overflow:auto">'
    +'<h2 style="margin:0 0 12px">Staff &amp; settings</h2>'
    +'<button id="adStats" style="width:100%;margin-bottom:16px">📊 Staff stats &amp; accountability</button>'
    +'<div style="font-weight:700;margin-bottom:8px">Staff accounts</div>'
    +'<div id="adUsers" style="margin-bottom:8px;font-size:13px;color:var(--mut)">Loading…</div>'
    +'<div style="display:flex;gap:8px;margin-bottom:6px">'
      +'<input id="adNewName" placeholder="New staff name" style="flex:1;padding:9px;border:1px solid var(--line);border-radius:8px">'
      +'<input id="adNewPin" inputmode="numeric" maxlength="4" placeholder="PIN" style="width:74px;padding:9px;border:1px solid var(--line);border-radius:8px;text-align:center;letter-spacing:.15em">'
      +'<button id="adAdd" class="primary">Add</button>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--mut);margin-bottom:14px">New staff default to PIN 1234 if left blank. PINs are 4 digits.</div>'
    +'<div id="adMsg" style="font-size:12px;min-height:16px;margin-bottom:10px"></div>'
    +'<div style="border-top:1px solid var(--line);padding-top:14px">'
      +'<div style="font-weight:700;margin-bottom:4px">Log everyone out</div>'
      +'<div style="font-size:12px;color:var(--mut);margin-bottom:10px">Immediately signs out every device, including yours. Everyone signs in again with their PIN.</div>'
      +'<button id="adRotate" style="width:100%">Log everyone out</button>'
    +'</div>'
    +'<div style="text-align:right;margin-top:16px"><button id="adClose">Close</button></div>'
    +'</div></div>');
  const close=()=>m.remove();
  $('#adClose',m).onclick=close; m.onclick=(e)=>{ if(e.target===m) close(); };
  $('#adStats',m).onclick=()=>{ close(); openStats(); };
  const msg=$('#adMsg',m); const setMsg=(t,bad)=>{ msg.textContent=t||''; msg.style.color=bad?'var(--accent)':'#3a7d3a'; };

  async function loadUsers(){
    const box=$('#adUsers',m);
    try{ const r=await fetch('/api/users',{headers:H}); const j=await r.json(); const list=j.users||[];
      box.innerHTML='';
      list.forEach(u=>{
        const row=el('<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)"></div>');
        const nm=el('<div style="flex:1;color:var(--ink)"><b>'+esc(u.name)+'</b>'+(u.admin?' <span style="font-size:10px;background:#eee;border-radius:6px;padding:1px 6px;color:#555">admin</span>':'')+'</div>');
        const setPin=el('<button style="font-size:12px;padding:5px 9px">Set PIN</button>');
        setPin.onclick=()=>{ const v=prompt('New 4-digit PIN for '+u.name+':'); if(v==null) return; if(!/^\\d{4}$/.test(v)){ setMsg('PIN must be 4 digits.',1); return; } userOp('pin',{name:u.name,pin:v}); };
        row.appendChild(nm); row.appendChild(setPin);
        if(!u.admin){ const rm=el('<button style="font-size:12px;padding:5px 9px;color:var(--accent)">Remove</button>'); rm.onclick=()=>{ if(confirm('Remove '+u.name+'?')) userOp('remove',{name:u.name}); }; row.appendChild(rm); }
        box.appendChild(row);
      });
      if(!list.length) box.textContent='No staff yet.';
    }catch(e){ box.textContent='Could not load staff.'; }
  }
  async function userOp(op, body){
    setMsg(''); try{ const r=await fetch('/api/users/'+op,{method:'POST',headers:H,body:JSON.stringify(body)}); const j=await r.json().catch(()=>({}));
      if(r.ok){ setMsg(op==='add'?'Added '+body.name+' (PIN '+(body.pin||'1234')+').':op==='pin'?'PIN updated for '+body.name+'.':'Removed '+body.name+'.'); loadUsers(); }
      else setMsg(j.error||'Failed.',1);
    }catch(e){ setMsg('Something went wrong.',1); }
  }
  $('#adAdd',m).onclick=()=>{ const name=$('#adNewName',m).value.trim(); const pin=$('#adNewPin',m).value.trim()||'1234';
    if(!name){ setMsg('Enter a name.',1); return; } if(!/^\\d{4}$/.test(pin)){ setMsg('PIN must be 4 digits.',1); return; }
    userOp('add',{name,pin}).then(()=>{ $('#adNewName',m).value=''; $('#adNewPin',m).value=''; }); };
  $('#adRotate',m).onclick=()=>{ if(!confirm('Sign out every device now? You will be signed out too.')) return;
    fetch('/admin/rotate',{method:'POST',headers:H}).then(r=>{ if(r.ok) location.replace('/'); else setMsg('Failed.',1); }).catch(()=>setMsg('Something went wrong.',1)); };

  document.body.appendChild(m); loadUsers();
}

function flashLabel(name){
  const oinfo=(current.orders||[]).find(o=>o.name===name)||{name};
  const a=addrCache[current.id+'|'+name]; const A=(a&&a.address)||{};
  const lines=[];
  const isPickup = oinfo.local || (!A.address1 && !A.name);
  if(isPickup){
    lines.push('<div class="ll-pickup">IN STORE PICKUP</div>');
    const nm=oinfo.customer||A.name||name;
    if(nm) lines.push('<div class="ll-nm">'+esc(nm)+'</div>');
    if(oinfo.date) lines.push('<div>'+esc(new Date(oinfo.date).toLocaleDateString())+'</div>');
    lines.push('<div>PAID'+(oinfo.total!=null?' '+esc(money(oinfo.total,oinfo.currency)):'')+'</div>');
  } else {
    const nm=A.name||oinfo.customer||name;
    if(nm) lines.push('<div class="ll-nm">'+esc(nm)+'</div>');
    if(A.company) lines.push('<div>'+esc(A.company)+'</div>');
    if(A.address1) lines.push('<div>'+esc(A.address1)+'</div>');
    if(A.address2) lines.push('<div>'+esc(A.address2)+'</div>');
    const cz=[A.city,A.provinceCode].filter(Boolean).join(' ')+(A.zip?'  '+A.zip:'');
    if(cz.trim()) lines.push('<div>'+esc(cz)+'</div>');
    if(A.countryCodeV2 && A.countryCodeV2!=='CA') lines.push('<div>'+esc(A.countryCodeV2)+'</div>');
  }
  if(!lines.length) lines.push('<div>'+esc(name)+'</div>');
  const old=document.getElementById('labelflash'); if(old) old.remove();
  const ov=el('<div id="labelflash" class="labelflash"><div class="llabel"><div class="laddr">'+lines.join('')+'</div><div class="lord">'+esc(name)+'</div></div></div>');
  document.body.appendChild(ov);
  setTimeout(()=>{ ov.classList.add('out'); setTimeout(()=>{ try{ov.remove();}catch(e){} },300); }, 2000);
}
async function printLabelFor(name, oinfo){
  let a;
  try{ const r=await fetch('/api/jobs/'+current.id+'/address',{method:'POST',headers:H,body:JSON.stringify({order:name})}); a=await r.json(); }
  catch(e){ alert('Address lookup failed: '+e.message); return; }
  if(a && a.error){ alert('Address: '+a.error); return; }
  openLabelDoc([{ name, address:(a&&a.address)||null, customerName:(a&&a.customerName)||'', total:(a&&a.total!=null?a.total:null), firstOrder:!!(a&&a.firstOrder), shippingMethod:(a&&a.shippingMethod)||'', code:(a&&a.code)||'', oinfo:oinfo||{} }]);
}
async function printAllLabels(btn, paper){
  const orders=current.orders||[]; if(!orders.length){ alert('No orders.'); return; }
  const old = btn && btn.textContent; if(btn){ btn.disabled=true; btn.textContent='Fetching addresses…'; }
  const labels=[];
  for(const o of orders){
    let a={};
    try{ const r=await fetch('/api/jobs/'+current.id+'/address',{method:'POST',headers:H,body:JSON.stringify({order:o.name})}); a=await r.json(); }catch(e){}
    labels.push({ name:o.name, address:(a&&a.address)||null, customerName:(a&&a.customerName)||'', total:(a&&a.total!=null?a.total:null), firstOrder:!!(a&&a.firstOrder), shippingMethod:(a&&a.shippingMethod)||'', code:(a&&a.code)||'', oinfo:o });
  }
  if(btn){ btn.disabled=false; btn.textContent=old; }
  if(paper) openLabelSheet(labels); else openLabelDoc(labels);
}
function labelInner(L){
  const A=L.address||{}, oinfo=L.oinfo||{};
  const lines=[];
  const isPickup = oinfo.local || (!A.address1 && !A.name);
  if(isPickup){
    lines.push('<div class="ll-pickup">IN STORE PICKUP</div>');
    const nm=oinfo.customer||A.name||L.customerName||'';
    lines.push('<div class="nm">'+esc(nm||L.name)+'</div>');
    if(oinfo.date) lines.push('<div>'+esc(new Date(oinfo.date).toLocaleDateString())+'</div>');
    lines.push('<div>PAID'+(oinfo.total!=null?' '+esc(money(oinfo.total,oinfo.currency)):'')+'</div>');
  } else {
    const nm=A.name||oinfo.customer||L.customerName||'';
    if(nm) lines.push('<div class="nm">'+esc(nm)+'</div>');
    if(A.company) lines.push('<div>'+esc(A.company)+'</div>');
    if(A.address1) lines.push('<div>'+esc(A.address1)+'</div>');
    if(A.address2) lines.push('<div>'+esc(A.address2)+'</div>');
    const cz=[A.city, A.provinceCode].filter(Boolean).join(' ')+(A.zip?'  '+A.zip:'');
    if(cz.trim()) lines.push('<div>'+esc(cz)+'</div>');
    if(A.countryCodeV2 && A.countryCodeV2!=='CA') lines.push('<div>'+esc(A.countryCodeV2)+'</div>');
  }
  if(!lines.length) lines.push('<div>'+esc(L.name)+'</div>');
  const ordHtml = isPickup ? esc(L.name) : (esc(L.name)+' · <span class="scode">'+(L.code||shipCode(L))+'</span>');
  return '<div class="label"><div class="addr">'+lines.join('')+'</div><div class="ord">'+ordHtml+'</div></div>';
}
// EXP by default; LTM when the delivery method is the lettermail bubble-mailer option —
// but a customer's FIRST order over $75 on that method flips back to EXP. (Server usually
// supplies L.code; this is a fallback that tolerates a weight suffix on the method title.)
function shipCode(L){
  const oinfo=L.oinfo||{};
  const method=String(L.shippingMethod||'').trim().toLowerCase();
  const isLTM=method.startsWith('lettermail - no tracking - bubble mailer');
  const total = (L.total!=null) ? +L.total : (oinfo.total!=null ? +oinfo.total : null);
  if(isLTM && L.firstOrder && total!=null && total>75) return 'EXP';
  return isLTM ? 'LTM' : 'EXP';
}
function openLabelDoc(labels){
  const body = labels.map(labelInner).join('');
  const html='<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>'
    +'@page{size:2in 1.5in;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}'
    +'.label{width:2in;height:1.5in;padding:0.1in 0.12in;font:bold 14px/1.22 Arial,Helvetica,sans-serif;color:#000;display:flex;flex-direction:column;text-align:center;page-break-after:always;overflow:hidden}'
    +'.label:last-child{page-break-after:auto}'
    +'.addr{flex:1;display:flex;flex-direction:column;justify-content:center;overflow:hidden;word-break:break-word}'
    +'.addr div{margin:0}.addr .nm{font-size:1.12em}.addr .ll-pickup{font-size:1.05em;font-weight:900;letter-spacing:.04em;margin-bottom:1px}.addr .ll-qty{font-size:.92em;font-weight:900;margin-bottom:2px}'
    +'.ord{border-top:1.5px solid #000;padding-top:2px;font-size:0.82em;letter-spacing:.03em}.ord .scode{font-weight:900;letter-spacing:.08em}'
    +'</style></head><body>'+body
    +'<script>function fit(){document.querySelectorAll(".label").forEach(function(L){var a=L.querySelector(".addr");var s=14;var g=0;L.style.fontSize=s+"px";while(a.scrollHeight>a.clientHeight&&s>7&&g<40){s-=0.5;L.style.fontSize=s+"px";g++;}});}fit();<\\/script>'
    +'</body></html>';
  // print via a hidden iframe so there is no awkward little window
  const ifr=document.createElement('iframe');
  ifr.style.cssText='position:fixed;left:-9999px;top:0;width:2in;height:1.5in;border:0;opacity:0';
  ifr.onload=()=>{
    setTimeout(()=>{
      try{ const w=ifr.contentWindow; w.focus(); w.onafterprint=()=>{ try{ifr.remove();}catch(e){} }; w.print(); }
      catch(e){ try{ifr.remove();}catch(_){}}
      setTimeout(()=>{ try{ifr.remove();}catch(e){} }, 60000);
    }, 200);
  };
  document.body.appendChild(ifr);
  const d=ifr.contentWindow.document; d.open(); d.write(html); d.close();
}
// Same label content, laid out as a grid on a regular Letter sheet (3 across) with
// dashed cut guides — for when you'd rather print on paper and cut than use label stock.
function openLabelSheet(labels){
  const body = labels.map(labelInner).join('');
  const html='<!doctype html><html><head><meta charset="utf-8"><title>Address labels</title><style>'
    +'@page{size:letter;margin:0.35in}*{box-sizing:border-box}html,body{margin:0;padding:0}'
    +'.sheet{display:flex;flex-wrap:wrap}'
    +'.label{width:2.55in;height:1.6in;padding:0.1in 0.12in;font:bold 14px/1.22 Arial,Helvetica,sans-serif;color:#000;display:flex;flex-direction:column;text-align:center;overflow:hidden;border:1px dashed #c4c4c4;break-inside:avoid;page-break-inside:avoid}'
    +'.addr{flex:1;display:flex;flex-direction:column;justify-content:center;overflow:hidden;word-break:break-word}'
    +'.addr div{margin:0}.addr .nm{font-size:1.12em}.addr .ll-pickup{font-size:1.05em;font-weight:900;letter-spacing:.04em;margin-bottom:1px}.addr .ll-qty{font-size:.92em;font-weight:900;margin-bottom:2px}'
    +'.ord{border-top:1.5px solid #000;padding-top:2px;font-size:0.82em;letter-spacing:.03em}.ord .scode{font-weight:900;letter-spacing:.08em}'
    +'</style></head><body><div class="sheet">'+body+'</div>'
    +'<script>function fit(){document.querySelectorAll(".label").forEach(function(L){var a=L.querySelector(".addr");var s=14;var g=0;L.style.fontSize=s+"px";while(a.scrollHeight>a.clientHeight&&s>7&&g<40){s-=0.5;L.style.fontSize=s+"px";g++;}});}fit();<\\/script>'
    +'</body></html>';
  const ifr=document.createElement('iframe');
  ifr.style.cssText='position:fixed;left:-9999px;top:0;width:8.5in;height:11in;border:0;opacity:0';
  ifr.onload=()=>{
    setTimeout(()=>{
      try{ const w=ifr.contentWindow; w.focus(); w.onafterprint=()=>{ try{ifr.remove();}catch(e){} }; w.print(); }
      catch(e){ try{ifr.remove();}catch(_){}}
      setTimeout(()=>{ try{ifr.remove();}catch(e){} }, 60000);
    }, 200);
  };
  document.body.appendChild(ifr);
  const d=ifr.contentWindow.document; d.open(); d.write(html); d.close();
}

function render(){
  const j=current, s=j.state, v=$('#view'); v.innerHTML='';
  v.appendChild(el('<h1 class="jtitle">#'+esc(j.id)+'</h1>'));
  // orders summary (shared component; same on every order page)
  v.appendChild(ordersBoxEl(null));

  // job note
  const jn = el('<textarea class="note" placeholder="Job notes…">'+esc(s.note||'')+'</textarea>');
  jn.oninput=()=>{ s.note=jn.value; patchNote(); }; v.appendChild(jn);

  // sealed
  if (j.sealed && j.sealed.length){ v.appendChild(el('<h2 class="gh">Sealed &amp; Accessories</h2>')); j.sealed.forEach(c=>v.appendChild(cardEl(c))); }
  // games
  (j.games||[]).forEach(g=>{
    v.appendChild(el('<h2 class="gh">'+esc(g.game||'Singles')+'</h2>'));
    (g.sets||[]).forEach(st=>{
      v.appendChild(el('<div class="sh">'+esc(st.setName)+'<span class="n">'+st.cards.length+' card'+(st.cards.length>1?'s':'')+'</span></div>'));
      let cards=st.cards;
      if(isPokGame(g.game)) cards=[...st.cards].sort((a,b)=>(a.card||'').localeCompare(b.card||''));
      cards.forEach(c=>v.appendChild(cardEl(c, g.game)));
    });
  });

  // footer
  const foot = el('<div class="foot"><span class="saved" id="saved"></span><span class="sp"></span><span class="fhint" id="fhint"></span></div>');
  const arch = el('<button class="archbtn">'+(s.archived===true?'Restore':'Archive')+'</button>');
  arch.onclick=()=>{ s.archived===true ? doArchive(false,false) : archiveModal(); };
  const breathe = el('<button class="breathe" title="Save and step away">Breathe</button>');
  breathe.onclick=()=>{ breathe.textContent='Saved ✓'; flushSaves(); setTimeout(()=>{ location.hash='#/'; }, 250); };
  footBtn = el('<button>Mark complete</button>');
  footBtn.onclick=()=>{
    if (s.status!=='complete' && remaining()>0) return;
    const next = s.status==='complete'?'open':'complete';
    sendPatch({op:'status', value:next}).then(j=>{ if(j&&j.error){ alert(j.error); return; } s.status=next; render(); });
  };
  foot.appendChild(breathe); foot.appendChild(arch); foot.appendChild(footBtn); document.body.appendChild(foot);
  // remove old footer if re-render
  const foots=document.querySelectorAll('.foot'); if(foots.length>1) foots[0].remove();
  refreshFoot();
  updateSaved();
}

function jobCards(){ const a=[]; (current.games||[]).forEach(g=>g.sets.forEach(s=>s.cards.forEach(c=>a.push(c)))); (current.sealed||[]).forEach(c=>a.push(c)); return a; }
function isPokGame(g){ return /pok[eé]mon|pkm/i.test(g||''); }
function manaPips(m){
  if(!m) return '';
  const syms=String(m).match(/\\{[^}]+\\}/g); if(!syms) return '';
  const out=syms.map(s=>{ const t=s.replace(/[{}]/g,'').toUpperCase();
    if(/^\\d+$/.test(t)||t==='X'||t==='C') return '<span class="pip pip-n">'+esc(t)+'</span>';
    const cls={W:'w',U:'u',B:'b',R:'r',G:'g'}[t];
    if(cls) return '<span class="pip pip-'+cls+'">'+t+'</span>';
    return '<span class="pip pip-n">'+esc(t.replace(/\\//g,''))+'</span>'; }).join('');
  return '<span class="mana">'+out+'</span>';
}
function cardSub(c){
  const pips=manaPips(c.mana);
  const parts=[];
  if(c.rarity) parts.push('<span class="rar">'+esc(c.rarity)+'</span>');
  if(c.sku) parts.push('<span class="sku">'+esc(c.sku)+'</span>');
  if(c.price) parts.push('<span class="prc">'+esc(money(c.price,c.currency))+'</span>');
  if(!pips && !parts.length) return '';
  return '<div class="sub">'+pips+parts.join(' · ')+'</div>';
}

function archiveModal(){
  const m = el('<div class="modal"><div class="sheetcard"><h2>Archive pull sheet?</h2>'
    + '<p style="margin:0 0 14px;color:#555;font-size:14px">It moves to History — nothing is deleted.</p>'
    + '<label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:16px;cursor:pointer">'
    +   '<input type="checkbox" id="rmtags" style="margin-top:3px"><span>Also remove the <b>PULLSHEET</b> and <b>quarantine1</b> tags from these '+current.orders.length+' order(s) in Shopify.</span></label>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end"><button id="acancel">Cancel</button><button id="ago" class="primary">Archive</button></div>'
    + '</div></div>');
  $('#acancel',m).onclick=()=>m.remove();
  $('#ago',m).onclick=()=>{ const rt=$('#rmtags',m).checked; m.remove(); doArchive(true, rt); };
  document.body.appendChild(m);
}

async function doArchive(archived, removeTags){
  const v=$('#view'); v.innerHTML='<div class="empty">'+(removeTags?'Removing tags & archiving…':(archived?'Archiving…':'Restoring…'))+'</div>';
  try {
    const r=await fetch('/api/jobs/'+current.id+'/archive',{method:'POST',headers:H,body:JSON.stringify({archived,removeTags,employee:who})});
    const j=await r.json();
    if(j.error){ alert('Failed: '+j.error); render(); return; }
    location.hash = archived ? '#/history' : '#/';
  } catch(e){ alert('Failed: '+e.message); render(); }
}

function remaining(){ const s=current.state; return jobCards().filter(c=>!(((+s.found[c.cid]||0)>=c.qty) || s.quarantined[c.cid])).length; }
function refreshFoot(){
  if(!footBtn) return; const s=current.state; const hint=document.getElementById('fhint');
  if(s.status==='complete'){ footBtn.textContent='Reopen'; footBtn.disabled=false; footBtn.className=''; if(hint) hint.textContent=''; return; }
  const rem=remaining();
  footBtn.textContent='Mark complete'; footBtn.disabled=rem>0; footBtn.className=rem>0?'':'primary';
  footBtn.style.opacity=rem>0?'.5':'1';
  if(hint) hint.textContent = rem>0 ? (rem+' card'+(rem>1?'s':'')+' left') : 'all accounted for';
}

function cardEl(c, game){
  const s=current.state; const need=c.qty; const showCn=c.collector && !isPokGame(game);
  const finTag = finOf(c.cond);
  const node = el('<div class="card">'
    + '<div class="ck"></div>'
    + (c.img?'<img class="th" src="'+esc(c.img)+'">':'')
    + '<div class="cbody">'
    +   '<div><span class="nm">'+esc(c.card)+'</span>'+(showCn?'<span class="cn">'+esc(c.collector)+'</span>':'')+'<span class="stat"></span></div>'
    +   cardSub(c)
    +   '<div class="cond">'+esc(condBase(c.cond))+(finTag?'<span class="fin fin-'+finTag.cls+'">'+finTag.t+'</span>':'')+'</div>'
    + '</div></div>');
  const ck=$('.ck',node), stat=$('.stat',node);
  const thumb=$('.th',node);
  if(thumb) thumb.onclick=(e)=>{ e.stopPropagation(); openImg(c.img); };
  const getF=()=>{ const f=+s.found[c.cid]; return isNaN(f)?0:f; };

  function paint(){
    const f=getF();
    node.classList.toggle('done', f>=need);
    node.classList.toggle('short', f>0 && f<need);
    ck.textContent = f>=need ? '✓' : (f>0 ? f : '');
    if (need>1) stat.innerHTML = f>=need ? '<span class="sdone">all '+need+'</span>'
                 : (f>0 ? '<span class="sshort">SHORT '+f+'/'+need+'</span>' : '<span class="sneed">need '+need+'</span>');
    else stat.innerHTML='';
    if (vEl) vEl.textContent=f;
  }
  const setF=(nv)=>{ nv=Math.max(0,Math.min(need,nv)); s.found[c.cid]=nv; paint(); refreshFoot(); patchFound(c.cid); };

  // big tick toggles all/none
  const toggle=()=>setF(getF()>=need?0:need);
  ck.onclick=toggle; $('.nm',node).onclick=toggle;

  // second row: needed/found stepper + note + quarantine + orders
  const r2=el('<div class="crow2"></div>');
  const qty=el('<div class="qty"><button>−</button><span class="v"></span><button>+</button></div>');
  var vEl=$('.v',qty); const [minus,plus]=qty.querySelectorAll('button');
  minus.onclick=()=>setF(getF()-1); plus.onclick=()=>setF(getF()+1);
  const ords=el('<div class="cardords">'+cardOrderChips(c.orders)+'</div>');
  const noteBtn=el('<button style="font-size:12px;padding:4px 10px">'+(s.cardNotes[c.cid]?'note ✎':'+ note')+'</button>');
  const qOn=!!s.quarantined[c.cid];
  const qBtn=el('<button class="qbtn'+(qOn?' on':'')+'" style="font-size:12px;padding:4px 10px">'+(qOn?'⚠ Quarantined':'Quarantine')+'</button>');
  qBtn.onclick=async()=>{ qBtn.disabled=true; const nx=!s.quarantined[c.cid];
    const jj=await qfetch('/quarantine',{cid:c.cid,on:nx}); qBtn.disabled=false;
    if(jj.error){ alert('Quarantine failed: '+jj.error); return; }
    s.quarantined[c.cid]=nx; qBtn.className='qbtn'+(nx?' on':''); qBtn.style.fontSize='12px'; qBtn.style.padding='4px 10px';
    qBtn.textContent=nx?'⚠ Quarantined':'Quarantine'; node.classList.toggle('quar',nx); refreshFoot(); };
  r2.appendChild(qty); r2.appendChild(noteBtn); r2.appendChild(qBtn); r2.appendChild(ords);
  $('.cbody',node).appendChild(r2);
  if(qOn) node.classList.add('quar');

  noteBtn.onclick=()=>{
    if ($('.cnote',node)) { $('.cnote',node).focus(); return; }
    const ta=el('<textarea class="note cnote" placeholder="Note for this card…">'+esc(s.cardNotes[c.cid]||'')+'</textarea>');
    ta.oninput=()=>{ s.cardNotes[c.cid]=ta.value; noteBtn.textContent=ta.value?'note ✎':'+ note'; patchCardNote(c.cid); };
    $('.cbody',node).appendChild(ta); ta.focus();
  };
  if (s.cardNotes[c.cid]){ const ta=el('<textarea class="note cnote">'+esc(s.cardNotes[c.cid])+'</textarea>'); ta.oninput=()=>{ s.cardNotes[c.cid]=ta.value; patchCardNote(c.cid); }; $('.cbody',node).appendChild(ta); }
  paint();
  return node;
}

// order number → Shopify admin link + hover card
function ordInfo(name){ return (current.orders||[]).find(o=>o.name===name) || { name }; }
function gidNum(gid){ const m=/Order\\/(\\d+)/.exec(gid||''); return m?m[1]:''; }
function money(a,c){ const n=Number(a); if(isNaN(n))return''; return (c==='USD'?'US$':'$')+n.toFixed(2); }
function ordLink(name){
  const o=ordInfo(name);
  const href = (current && current.id) ? ('#/job/'+current.id+'/order/'+encodeURIComponent(name)) : '#';
  const tip='<span class="tip"><b>'+esc(o.customer||name)+'</b>'
    + (o.date?'<br>'+new Date(o.date).toLocaleString():'')
    + '<br><span class="'+(o.local?'pickup':'ship')+'">'+(o.local?'LOCAL PICKUP':esc(o.shipping||'Shipping'))+'</span>'
    + '<br>'+(o.total!=null?money(o.total,o.currency):'')+(o.itemQty!=null?' · '+o.itemQty+' items':'')+'</span>';
  return '<a class="ord-link" href="'+href+'">'+esc(name)+tip+'</a>';
}
function ordersLinks(o){ return (o||[]).map(x=>ordLink(x.name)+(x.qty>1?'<span class="ox">×'+x.qty+'</span>':'')).join(' '); }
function cardOrderChips(orders){
  return (orders||[]).map(x=>{
    const o=ordInfo(x.name);
    const href=(current&&current.id)?('#/job/'+current.id+'/order/'+encodeURIComponent(x.name)):'#';
    return '<a class="cardord" href="'+href+'"><b>'+esc(x.name)+'</b>'+(o.customer?'<span class="con">'+esc(o.customer)+'</span>':'')+(x.qty>1?'<span class="cq">×'+x.qty+'</span>':'')+'</a>';
  }).join('');
}
function condBase(c){ return String(c||'').replace(/reverse|holofoil|holo|foil/gi,'').replace(/\\s{2,}/g,' ').trim(); }
function hiRes(src){ return String(src||'').replace(/_(?:\\d+x\\d+|\\d+x|x\\d+|small|medium|large|grande|compact|pico|icon|thumb|master)(?=\\.[a-z]+(?:[?#]|$))/i, ''); }
function openImg(src){ if(!src) return; const lb=el('<div class="lightbox"><img src="'+esc(hiRes(src))+'"></div>'); lb.onclick=()=>lb.remove(); document.body.appendChild(lb); }
function finOf(c){ c=String(c||''); if(/reverse\\s*holo/i.test(c))return{t:'REV HOLO',cls:'rev'}; if(/holo/i.test(c))return{t:'HOLO',cls:'holo'}; if(/\\bfoil\\b/i.test(c))return{t:'FOIL',cls:'foil'}; return null; }

// ── Per-field saves. All saves go through ONE queue (one request in flight at a
// time) so rapid taps can't fire concurrent writes that overwrite each other on
// the server. Each save still patches a single field, re-read fresh server-side.
const pend = {};
let _saveChain = Promise.resolve();
let inflight = 0, lastSaveAt = 0;   // for live-sync safety: don't pull remote state over un-saved local edits
function queueSend(task){
  inflight++;
  const wrapped = async ()=>{ try{ return await task(); } finally { inflight--; lastSaveAt=Date.now(); } };
  const run = _saveChain.then(wrapped, wrapped); _saveChain = run.catch(()=>{}); return run;
}
function debounce(key, ms, run){ if(pend[key]) clearTimeout(pend[key].t); pend[key]={t:setTimeout(()=>{ delete pend[key]; run(); }, ms), run}; }
function flushSaves(){ Object.keys(pend).forEach(k=>{ clearTimeout(pend[k].t); const r=pend[k].run; delete pend[k]; r(); }); }
function qfetch(path, body){ const id=current&&current.id; if(!id) return Promise.resolve({}); return queueSend(async ()=>{ try{ const r=await fetch('/api/jobs/'+id+path,{method:'POST',headers:H,body:JSON.stringify(Object.assign({employee:who},body||{}))}); return await r.json(); }catch(e){ return {error:String(e.message||e)}; } }); }
async function sendPatch(body){
  if(!current) return {};
  const id=current.id;
  updateSaved('saving…');
  return queueSend(async ()=>{
    try{
      const r=await fetch('/api/jobs/'+id+'/patch',{method:'POST',headers:H,body:JSON.stringify(Object.assign({employee:who},body))});
      const j=await r.json();
      if(current && current.id===id && j && j.lastSavedAt){ const s=current.state; s.lastSavedAt=j.lastSavedAt; s.lastSavedBy=j.lastSavedBy; if(j.workedBy) s.workedBy=j.workedBy; }
      updateSaved();
      return j||{};
    }catch(e){ updateSaved('save failed'); return {error:String(e.message||e)}; }
  });
}
function patchFound(cid){ debounce('f'+cid, 350, ()=>sendPatch({op:'found', cid, value:current.state.found[cid]||0})); }
function patchCardNote(cid){ debounce('cn'+cid, 600, ()=>sendPatch({op:'cardNote', cid, value:current.state.cardNotes[cid]||''})); }
function patchNote(){ debounce('note', 600, ()=>sendPatch({op:'note', value:current.state.note||''})); }
function updateSaved(txt){ const e=$('#saved'); if(!e) return; const st = (currentOrder && current && current.state && current.state.orders && current.state.orders[currentOrder]) ? current.state.orders[currentOrder] : (current&&current.state);
  e.textContent = txt || (st&&st.lastSavedAt? 'Saved '+new Date(st.lastSavedAt).toLocaleTimeString()+(st.lastSavedBy?' · '+st.lastSavedBy:'') : ''); }

let lastSig='', lastActivity=Date.now();
const IDLE_MS=5*60*1000;                 // pause polling after this
const IDLE_LOGOUT_MS=10*60*1000;         // sign out after this
const IDLE_WARN_MS=IDLE_LOGOUT_MS-60*1000; // warn 60s before
let idleWarnEl=null;
function markActive(){ const wasIdle=(Date.now()-lastActivity)>IDLE_MS; lastActivity=Date.now(); if(idleWarnEl){ idleWarnEl.remove(); idleWarnEl=null; } if(wasIdle) pollList(); }
['pointerdown','keydown','touchstart','wheel'].forEach(ev=>document.addEventListener(ev, markActive, {passive:true}));
window.addEventListener('focus', markActive);
function idleLogout(){ try{ fetch('/logout',{method:'POST'}); }catch(e){} location.replace('/'); }
function showIdleWarning(){
  idleWarnEl=el('<div class="modal" style="z-index:50"><div class="sheetcard" style="width:min(360px,92vw);text-align:center">'
    +'<h2 style="margin:0 0 8px">Still there?</h2>'
    +'<div style="color:var(--mut);font-size:14px;margin-bottom:16px">You\u2019ll be signed out in <b id="idlesecs">60</b> seconds.</div>'
    +'<button id="idlestay" class="primary" style="width:100%">Stay signed in</button>'
    +'<button id="idleout" style="width:100%;margin-top:8px">Sign out now</button>'
    +'</div></div>');
  idleWarnEl.querySelector('#idlestay').onclick=()=>markActive();
  idleWarnEl.querySelector('#idleout').onclick=idleLogout;
  document.body.appendChild(idleWarnEl);
}
function checkIdle(){
  const idle=Date.now()-lastActivity;
  if(idle>=IDLE_LOGOUT_MS){ idleLogout(); return; }
  if(idle>=IDLE_WARN_MS){ if(!idleWarnEl) showIdleWarning(); const s=idleWarnEl&&idleWarnEl.querySelector('#idlesecs'); if(s) s.textContent=Math.max(0,Math.ceil((IDLE_LOGOUT_MS-idle)/1000)); }
}
// ── Live sync of an OPEN sheet/order across devices (poll + safe apply) ──
// Reads are the cheap KV quota; this pauses when idle/hidden and never overwrites
// un-saved local edits. KV is eventually consistent, so we wait a beat after our own
// saves before pulling, and show a tap-to-load chip instead of yanking the view mid-work.
const SYNC_MS=2000, SAVE_SETTLE_MS=4000;
let openSig=null, syncing=false, chipEl=null, pendingRemote=null;
function openStateSig(st){ st=st||{}; const o={}; const os=st.orders||{}; for(const k in os){ const x=os[k]||{}; o[k]={f:x.found||{},r:x.refunded||{},s:x.status||'',p:x.packedAt||''}; } return JSON.stringify({f:st.found||{},q:st.quarantined||{},n:st.note||'',cn:st.cardNotes||{},o:o}); }
function removeChip(){ if(chipEl){ chipEl.remove(); chipEl=null; } pendingRemote=null; }
function showUpdateChip(){ if(chipEl) return; chipEl=el('<button class="synchip">🔄 Updated on another device — tap to load</button>'); chipEl.onclick=()=>{ const j=pendingRemote; removeChip(); if(j) applyRemote(j); }; document.body.appendChild(chipEl); }
function applyRemote(j){
  if(!current || current.id!==j.id) return;
  current=j; openSig=openStateSig(j.state); removeChip();
  const h=location.hash.replace(/^#\\/?/,''); const y=window.scrollY;
  if(/\\/order\\//.test(h)) renderOrder(); else render();
  window.scrollTo(0,y);
}
async function syncOpen(){
  if(syncing || document.hidden) return;
  if(Date.now()-lastActivity > IDLE_MS) return;
  const h=location.hash.replace(/^#\\/?/,'');
  if(!current || !h.startsWith('job/')){ openSig=null; removeChip(); return; }
  if(inflight>0 || Object.keys(pend).length) return;        // un-saved local edits pending
  syncing=true;
  try{
    const r=await fetch('/api/jobs/'+current.id,{headers:H}); if(!r.ok) return;
    const j=await r.json(); if(!j || !j.state || !current || current.id!==j.id) return;
    const remoteSig=openStateSig(j.state), localSig=openStateSig(current.state);
    if(remoteSig===localSig){ openSig=remoteSig; removeChip(); return; }
    if(Date.now()-lastSaveAt < SAVE_SETTLE_MS) return;        // let our own write settle in KV first
    if(inflight>0 || Object.keys(pend).length) return;        // re-check after await
    const ae=document.activeElement; const typing=ae&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT');
    const busy = typing || document.querySelector('.modal') || (Date.now()-lastActivity < 2500);
    if(busy){ pendingRemote=j; showUpdateChip(); }
    else { applyRemote(j); }
  }catch(e){}
  finally{ syncing=false; }
}
async function pollList(){
  if(document.hidden) return;
  if(Date.now()-lastActivity > IDLE_MS) return; // idle: stop polling so an open tab doesn't burn KV ops
  const h=location.hash.replace(/^#\\/?/,'');
  if(!(h===''||h==='history')) return;
  if(document.querySelector('.modal')) return;
  const sb=document.getElementById('osearch');
  if(sb && (document.activeElement===sb || (sb.value||'').trim())) return;
  try{ const r=await fetch('/api/joblist',{headers:H}); const {sig}=await r.json();
    if(lastSig && sig!==lastSig){ const y=window.scrollY; await showList(h==='history'?'history':'active', true); window.scrollTo(0,y); }
    lastSig=sig;
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) markActive(); });
(function(){ const ab=document.getElementById('adminBtn'); if(ab) ab.onclick=openAdmin; setInterval(pollList, 30000); setInterval(checkIdle, 1000); setInterval(syncOpen, SYNC_MS); })();
setWho(); route();
</script>
</body></html>`;